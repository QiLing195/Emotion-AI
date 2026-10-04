"""把 Laya 的某个 checkpoint 直接下进 HF cache 的 snapshot 目录（断点续传 + 分块并行）。

为什么不用 `hf_hub_download`：本机（2026-09 实测）`huggingface_hub` 1.19 走 Xet bridge 时
**卡在 0 字节不动**（`HF_HUB_DISABLE_XET=1` 也一样），而同一台机器上 `urllib` 直接 GET
`/resolve/main/...` 有 ~0.5 MB/s。所以就自己下 —— 单线程 614 MB 要 20 分钟，
8 个分块并行实测快 4~6 倍。

用法：
    python scripts/laya-fetch-ckpt.py --repo convaiinnovations/laya \
        --subfolder multilingual --file model.safetensors \
        --out <HF cache 的 snapshot 里的那个路径>

下完后用 `HF_HUB_OFFLINE=1 laya-serve` 起服务，避免 hub 再去 HEAD 一次。

⚠️ **先写 `--out.partial`，全部完成才改名**。这不是洁癖：第一版直接 `truncate` 出全尺寸的
`--out`，于是**进程还在下的时候 `ls` 就已经显示 614 MB** —— 当时就有人（我）据此以为下完了，
把服务起在了半截文件上，模型加载成功、推理不报错，但输出是**均匀分布**（永远选第一个标签）。
半截的模型文件不会报错，只会骗人。
"""
import argparse
import hashlib
import json
import os
import sys
import threading
import time
import urllib.request

CHUNK = 8 * 1024 * 1024  # 8 MiB per range request


def head_size(url: str) -> int:
    req = urllib.request.Request(url, method='GET', headers={'Range': 'bytes=0-0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        cr = r.headers.get('Content-Range')
        if cr and '/' in cr:
            return int(cr.rsplit('/', 1)[1])
    raise RuntimeError('server did not return Content-Range; cannot determine size')


def worker(url, path, start, end, idx, state, lock):
    req = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'})
    for attempt in range(1, 6):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if len(data) != end - start + 1:
                raise RuntimeError(f'short read {len(data)} != {end - start + 1}')
            with open(path, 'r+b') as f:
                f.seek(start)
                f.write(data)
            with lock:
                state['done'] += len(data)
                state['parts'] += 1
            return
        except Exception as e:  # noqa: BLE001
            if attempt == 5:
                with lock:
                    state['errors'].append(f'part{idx}: {e}')
                return
            time.sleep(1.5 * attempt)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default='convaiinnovations/laya')
    ap.add_argument('--subfolder', default='multilingual')
    ap.add_argument('--file', default='model.safetensors')
    ap.add_argument('--out', required=True, help='最终落盘路径（HF cache 的 snapshot 内）')
    ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--endpoint', default='https://huggingface.co')
    args = ap.parse_args()

    url = f"{args.endpoint}/{args.repo}/resolve/main/{args.subfolder}/{args.file}"
    total = head_size(url)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    if os.path.exists(args.out) and os.path.getsize(args.out) == total:
        print(f'already complete: {args.out} ({total} bytes)')
        return 0
    # 下到 .partial，完成才改名 —— 中途的 out 路径**必须不存在**，
    # 否则"文件已存在且尺寸正确"会让调用方以为可以用了（见模块 docstring）
    tmp = args.out + '.partial'
    if os.path.exists(args.out):
        os.remove(args.out)
    print(f'total {total / 1048576:.1f} MB -> {args.out}（先写 {os.path.basename(tmp)}）')

    with open(tmp, 'wb') as f:
        f.truncate(total)

    ranges = [(s, min(s + CHUNK - 1, total - 1)) for s in range(0, total, CHUNK)]
    state = {'done': 0, 'parts': 0, 'errors': []}
    lock = threading.Lock()
    started = time.time()
    threads = []
    queue = list(enumerate(ranges))
    qlock = threading.Lock()

    def runner():
        while True:
            with qlock:
                if not queue:
                    return
                idx, (s, e) = queue.pop(0)
            worker(url, tmp, s, e, idx, state, lock)

    for _ in range(args.workers):
        t = threading.Thread(target=runner, daemon=True)
        t.start()
        threads.append(t)

    last = 0
    while any(t.is_alive() for t in threads):
        time.sleep(5)
        with lock:
            done = state['done']
        rate = (done - last) / 5 / 1048576
        last = done
        print(f"  {done / 1048576:7.1f} / {total / 1048576:.1f} MB  ({rate:.2f} MB/s, {state['parts']}/{len(ranges)} parts)", flush=True)
    for t in threads:
        t.join()

    if state['errors']:
        print('ERRORS:\n  ' + '\n  '.join(state['errors'][:5]), file=sys.stderr)
        print(f'半截文件留在 {tmp}，修好后重跑（脚本会整份重下，不做断点续传）', file=sys.stderr)
        return 2
    got = os.path.getsize(tmp)
    if got != total:
        print(f'size mismatch: {got} != {total}', file=sys.stderr)
        return 3
    os.replace(tmp, args.out)
    print(f'done in {time.time() - started:.0f}s, {got / 1048576:.1f} MB → {args.out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
