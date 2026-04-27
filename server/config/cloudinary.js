const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const streamifier = require('streamifier');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50*1024*1024 } });

const uploadToCloudinary = (buffer, folder, resourceType='auto') => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    { folder, resource_type: resourceType },
    (err, result) => err ? reject(new Error(err.message)) : resolve(result)
  );
  streamifier.createReadStream(buffer).pipe(stream);
});

module.exports = { upload, uploadToCloudinary, cloudinary };
