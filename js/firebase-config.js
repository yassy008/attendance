// Firebase の設定値（公開してよい値です。データはセキュリティルールで守ります）
// この値を空にすると、試作版と同じ「このPCのブラウザ内だけに保存」の動きに戻ります。
export const firebaseConfig = {
  apiKey: 'AIzaSyB6dnTTx8csCwnqC7rupVHwE3eYYVM5YjY',
  authDomain: 'attendance-meijo.firebaseapp.com',
  projectId: 'attendance-meijo',
  storageBucket: 'attendance-meijo.firebasestorage.app',
  messagingSenderId: '719183816860',
  appId: '1:719183816860:web:155806abb39bdc3e7b6559',
};

// 教員としてログインできるメールアドレスの範囲（空にすると、どのGoogleアカウントでも使えます）
export const allowedEmailDomain = 'meijo-u.ac.jp';

export const useFirebase = !!firebaseConfig.apiKey;
