import { Application, Request, Response } from 'express';
import crypto from 'crypto';
import { DefaultAIEngine } from '../aiEngine.js';

export function escapeXmlCdata(value: string): string {
  return value.replaceAll(']]>', ']]]]><![CDATA[>');
}

export class WeChatOfficialAccountChannel {
  id = 'wechat_official';
  name = '微信公众号';
  private config: any = null;
  private aiEngine: DefaultAIEngine | null = null;

  setConfig(config: any) {
    this.config = config;
  }

  private checkSignature(req: Request): boolean {
    if (!this.config) return false;
    const { token } = this.config;
    if (!token) return false;

    const signature = req.query.signature as string;
    const timestamp = req.query.timestamp as string;
    const nonce = req.query.nonce as string;
    const echostr = req.query.echostr as string;

    if (!signature || !timestamp || !nonce) return false;

    const tmpArr = [token, timestamp, nonce].sort();
    const tmpStr = tmpArr.join('');
    const sha1 = crypto.createHash('sha1').update(tmpStr).digest('hex');

    return sha1 === signature;
  }

  private async handleMessage(req: Request, res: Response) {
    if (!this.aiEngine) {
      res.status(500).send('AI引擎未初始化');
      return;
    }

    try {
      const { xml } = req.body;
      const msgType = xml?.MsgType?.[0];
      const fromUser = xml?.FromUserName?.[0];
      const content = xml?.Content?.[0];

      console.log(`[WeChat] Received message from ${fromUser}: ${content}`);

      if (msgType === 'text' && content && fromUser) {
        // Get AI response
        const aiResponse = await this.aiEngine.generateResponse(content, fromUser);

        // Format WeChat XML response
        const responseXml = `
<xml>
  <ToUserName><![CDATA[${escapeXmlCdata(fromUser)}]]></ToUserName>
  <FromUserName><![CDATA[${escapeXmlCdata(xml?.ToUserName?.[0] || '')}]]></FromUserName>
  <CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${escapeXmlCdata(aiResponse.text)}]]></Content>
</xml>`;

        res.set('Content-Type', 'application/xml');
        res.send(responseXml);
      } else {
        res.send('');
      }
    } catch (error) {
      console.error('[WeChat] Error handling message:', error);
      res.status(500).send('处理消息时出错');
    }
  }

  registerRoutes(app: Application, aiEngine: DefaultAIEngine) {
    this.aiEngine = aiEngine;

    // WeChat verification endpoint (GET)
    app.get('/api/channel/wechat/callback', (req: Request, res: Response) => {
      if (this.checkSignature(req)) {
        const echostr = req.query.echostr as string;
        res.send(echostr);
      } else {
        res.status(403).send('签名验证失败');
      }
    });

    // WeChat message endpoint (POST)
    app.post('/api/channel/wechat/callback', async (req: Request, res: Response) => {
      if (!this.checkSignature(req)) {
        res.status(403).send('签名验证失败');
        return;
      }
      await this.handleMessage(req, res);
    });

    console.log('[WeChat] Routes registered at /api/channel/wechat/callback');
  }
}
