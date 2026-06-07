// MongoDB connection for Kiosk UI
import mongoose from 'mongoose';

export async function connectMongoDB(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn(
      'MONGODB_URI not set. Database features will not work without it.',
    );
    return;
  }
  try {
    await mongoose.connect(uri);
    console.log('✅ MongoDB connected (Kiosk)');
  } catch (err: any) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
}

export { mongoose };