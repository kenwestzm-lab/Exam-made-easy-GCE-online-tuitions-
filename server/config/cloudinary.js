const cloudinary = require('cloudinary').v2;
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
  secure: true,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const uploadToCloudinary = (buffer, folder, resourceType = 'auto') => {
  if (!process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME === '') {
    console.warn('Cloudinary not configured');
    return Promise.resolve({ secure_url: '', public_id: '' });
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType, timeout: 60000 },
      (err, result) => err ? reject(new Error(err.message)) : resolve(result)
    );
    stream.write(buffer);
    stream.end();
  });
};

module.exports = { upload, uploadToCloudinary, cloudinary };
