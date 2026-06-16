import { IIoTProvider } from '../interfaces.js';

export class MockIoTProvider implements IIoTProvider {
  id = 'mock_iot';
  name = 'Mock IoT Provider';

  private deviceStates: Map<string, 'on' | 'off'> = new Map();

  async toggleDevice(deviceId: string, status: 'on' | 'off'): Promise<{ success: boolean; message?: string }> {
    try {
      // Simulate device toggle
      this.deviceStates.set(deviceId, status);

      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log(`[MockIoT] Device ${deviceId} set to ${status}`);

      return {
        success: true,
        message: `设备 ${deviceId} 已${status === 'on' ? '打开' : '关闭'}`
      };
    } catch (error) {
      console.error(`[MockIoT] Failed to toggle device ${deviceId}:`, error);
      return {
        success: false,
        message: `操作失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  getDeviceState(deviceId: string): 'on' | 'off' | undefined {
    return this.deviceStates.get(deviceId);
  }
}