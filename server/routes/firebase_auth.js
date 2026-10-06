const express = require('express');
const { getAuth } = require('firebase-admin/auth');
const { User } = require('../models');

const router = express.Router();

router.post('/verify', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'Firebase ID token is required' });
    }

    const decodedToken = await getAuth().verifyIdToken(idToken);

    const user = await User.findOne({ firebaseUid: decodedToken.uid });

    if (!user) {
      return res.status(403).json({
        error: 'Firebase account is not linked to a school account'
      });
    }

    res.json({
      success: true,
      uid: decodedToken.uid,
      email: decodedToken.email || null,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        approved: user.approved
      }
    });

  } catch (error) {
    console.error('Firebase token verification failed:', error.message);
    res.status(401).json({ error: 'Invalid Firebase ID token' });
  }
});

module.exports = router;
