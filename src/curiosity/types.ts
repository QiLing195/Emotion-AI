// v4.0: 好奇心引擎 — 类型定义 & 常量

// ── 兴趣模型 ──
export interface Interest {
    topic: string;
    weight: number;
    source: 'conversation' | 'manual' | 'discovery';
    firstSeen: number;
    lastUpdated: number;
    stability: number;
}

export interface InterestModel {
    interests: Interest[];
    lastExploration: number;
    lastDecayDay: string;
}

// ── 发现记忆 ──
export interface Discovery {
    id: string;
    title: string;
    content: string;
    url?: string;
    topic: string;
    timestamp: number;
    shared: boolean;
    quality: number;
    sourceType: 'web' | 'ai_generated';
    verified: boolean;
}

// ── 兴趣关键词库 ──
export const INTEREST_KEYWORDS: Record<string, string[]> = {
    '美食': ['美食', '好吃', '食物', '餐厅', '做饭', '料理', '甜品', '火锅', '烧烤', '小吃', '食谱', '食材', '味道', '吃', '喝', '奶茶', '咖啡', '茶'],
    '旅行': ['旅行', '旅游', '出游', '景点', '风景', '自驾', '徒步', '海边', '爬山', '度假', '打卡', '机票', '酒店'],
    '音乐': ['音乐', '歌', '歌曲', '听歌', '歌手', '演唱会', '钢琴', '吉他', '乐队', '旋律', '专辑', '作曲'],
    '电影': ['电影', '看片', '电影院', '导演', '演员', '剧情', '纪录片', '动画', '番剧', '追剧', '剧集'],
    '科技': ['科技', 'AI', '人工智能', '编程', '代码', '技术', '软件', '硬件', '手机', '电脑', '机器人', '芯片', '互联网'],
    '游戏': ['游戏', '打游戏', '电竞', '手游', '端游', '主机', 'Switch', 'PS5', 'Xbox', 'steam'],
    '摄影': ['摄影', '拍照', '相机', '照片', '镜头', '构图', '滤镜', '自拍', '风景照'],
    '读书': ['读书', '看书', '书', '小说', '阅读', '文学', '诗歌', '散文', '作者', '图书馆'],
    '运动': ['运动', '健身', '跑步', '瑜伽', '游泳', '篮球', '足球', '羽毛球', '骑行', '马拉松', '健身房'],
    '宠物': ['宠物', '猫', '狗', '猫咪', '狗狗', '养宠', '撸猫', '遛狗', '萌宠'],
    '时尚': ['时尚', '穿搭', '衣服', '潮牌', '美妆', '护肤', '发型', '配饰', '包包'],
    '艺术': ['艺术', '画', '绘画', '博物馆', '展览', '设计', '雕塑', '建筑', '手工', 'DIY'],
};

// ── 兴趣稳定性分类 ──
export const INTEREST_STABILITY: Record<string, number> = {
    'identity': 0.995,
    'hobby': 0.985,
    'transient': 0.94,
};

export const INTEREST_CATEGORY: Record<string, keyof typeof INTEREST_STABILITY> = {
    '宠物': 'identity', '美食': 'identity',
    '摄影': 'hobby', '音乐': 'hobby', '读书': 'hobby', '运动': 'hobby', '艺术': 'hobby',
    '旅行': 'transient', '科技': 'transient', '电影': 'transient', '游戏': 'transient', '时尚': 'transient',
};

// ── 探索参数 ──
export const EXPLORATION_CYCLE_MS = 30 * 60 * 1000;
export const EXPLORATION_IDLE_MIN = 10;
export const EXPLORATION_DAILY_CAP = 8;
export const EXPLORATION_COLD_START_CAP = 2;
export const EXPLORATION_COLD_START_MIN_INTERESTS = 3;
export const DISCOVERY_SHARE_QUALITY = 0.5;
export const DISCOVERY_DAILY_SHARE_CAP = 2;
export const MAX_DISCOVERIES = 200;
export const EXPLORATION_SEARCH_COUNT = 2;
