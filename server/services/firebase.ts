import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class FirebaseService {
  private db: any = null;

  constructor() {
    this.initialize();
  }

  private initialize() {
    try {
      const configPath = path.join(__dirname, '..', '..', 'firebase-applet-config.json');
      if (!fs.existsSync(configPath)) {
        console.warn('Firebase config file not found. Firebase features will be disabled.');
        return;
      }

      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

      // ponytail: 无凭证时跳过 Firestore，避免 gRPC 内部未捕获的 credential 重试崩溃
      const hasCredentials = !!(
        process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        firebaseConfig.private_key ||
        firebaseConfig.client_email
      );
      if (!hasCredentials) {
        console.warn('Firebase credentials not found. Firestore persistence disabled.');
        return;
      }

      if (getApps().length === 0) {
        initializeApp({
          projectId: firebaseConfig.projectId,
        });
      }
      this.db = getFirestore();
      console.log('Firebase Admin initialized successfully');
    } catch (e) {
      console.error('Failed to initialize Firebase Admin:', e);
      this.db = null;
    }
  }

  getDb() {
    return this.db;
  }

  async getUserData(userId: string) {
    if (!this.db) return null;

    try {
      const userDoc = await this.db.collection('users').doc(userId).get();
      if (userDoc.exists) {
        return userDoc.data();
      }
    } catch (e) {
      console.error('Failed to fetch user data from Firestore:', e);
    }
    return null;
  }

  async saveUserData(userId: string, data: any) {
    if (!this.db) return false;

    try {
      await this.db.collection('users').doc(userId).set(data, { merge: true });
      return true;
    } catch (e) {
      console.error('Failed to save user data to Firestore:', e);
      return false;
    }
  }

  async saveMessage(userId: string, message: any) {
    if (!this.db) return false;

    try {
      const timestamp = new Date().toISOString();
      await this.db.collection('users').doc(userId).collection('messages').doc(`msg_${Date.now()}_${message.role}`).set({
        uid: userId,
        role: message.role,
        content: message.content,
        timestamp: timestamp
      });
      return true;
    } catch (e) {
      console.error('Failed to save message to Firestore:', e);
      return false;
    }
  }
}

// Export a singleton instance
export const firebaseService = new FirebaseService();
