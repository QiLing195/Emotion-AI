import admin from 'firebase-admin';
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
      if (fs.existsSync(configPath)) {
        const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (admin.apps.length === 0) {
          admin.initializeApp({
            projectId: firebaseConfig.projectId,
          });
        }
        this.db = getFirestore();
        console.log('Firebase Admin initialized successfully');
      } else {
        console.warn('Firebase config file not found. Firebase features will be disabled.');
      }
    } catch (e) {
      console.error('Failed to initialize Firebase Admin:', e);
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