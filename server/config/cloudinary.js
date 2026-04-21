const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const streamifier = require('streamifier');
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});
const uploadToCloudinary = (buffer, folder='peace-mindset', type='auto') => new Promise((res,rej) => {
  const s = cloudinary.uploader.upload_stream({folder, resource_type:type},(e,r)=>{if(e)return rej(e);res(r);});
  streamifier.createReadStream(buffer).pipe(s);
});
const upload = multer({storage:multer.memoryStorage(), limits:{fileSize:50*1024*1024}});
module.exports = {cloudinary, upload, uploadToCloudinary};
