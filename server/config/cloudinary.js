const cloudinary=require('cloudinary').v2;
const multer=require('multer');

cloudinary.config({
  cloud_name:process.env.CLOUDINARY_CLOUD_NAME||'',
  api_key:process.env.CLOUDINARY_API_KEY||'',
  api_secret:process.env.CLOUDINARY_API_SECRET||'',
});

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:50*1024*1024}});

const uploadToCloudinary=(buffer,folder,resourceType='auto')=>{
  const cn=process.env.CLOUDINARY_CLOUD_NAME;
  if(!cn||cn===''||cn==='placeholder'){
    console.log('Cloudinary not configured');
    return Promise.resolve({secure_url:'',public_id:''});
  }
  return new Promise((resolve,reject)=>{
    const stream=cloudinary.uploader.upload_stream({folder,resource_type:resourceType},(err,result)=>{
      if(err){console.error('Cloudinary error:',err.message);reject(new Error(err.message||'Upload failed'));}
      else resolve(result);
    });
    stream.write(buffer);
    stream.end();
  });
};

module.exports={upload,uploadToCloudinary,cloudinary};
