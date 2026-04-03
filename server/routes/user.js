const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const cloudinary = require('cloudinary').v2;
const supabase   = require('../services/supabase');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── POST /user/sync ──────────────────────────────────────
// Called on every login — upserts Firebase user into Supabase users table
// Body: { name, email, role, grade?, school?, curriculum?, location? }

router.post('/sync', async (req, res) => {
  try {
    const { name, email, role, grade, school, curriculum, location } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });

    // Build upsert patch — only include fields that are provided
    const patch = { name: name || email.split('@')[0], email: email.toLowerCase().trim() };
    if (role)       patch.role       = role;
    if (grade)      patch.grade      = grade;
    if (school)     patch.school     = school.trim();
    if (curriculum) patch.curriculum = curriculum;
    if (location)   patch.location   = location;

    const { data, error } = await supabase
      .from('users')
      .upsert(patch, { onConflict: 'email' })
      .select('id, name, email, role, grade, school, curriculum, location, onboarding_complete, photo_url')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Auto-create student_stats if role is student
    if ((role === 'student' || data?.role === 'student') && data?.id) {
      await supabase.from('student_stats')
        .upsert({ student_id: data.id }, { onConflict: 'student_id', ignoreDuplicates: true });
    }

    res.json({
      id:                 data.id,
      name:               data.name,
      email:              data.email,
      role:               data.role,
      grade:              data.grade,
      school:             data.school,
      curriculum:         data.curriculum,
      location:           data.location,
      onboardingComplete: data.onboarding_complete,
      photoUrl:           data.photo_url ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /user/profile ──────────────────────────────────
// Updates profile fields for a logged-in user (curriculum, grade, school, location)
// Body: { email, curriculum, grade, school, location }

router.patch('/profile', async (req, res) => {
  try {
    const { email, curriculum, grade, school, location } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });

    const patch = { onboarding_complete: true };
    if (curriculum) patch.curriculum = curriculum;
    if (grade)      patch.grade      = grade;
    if (school)     patch.school     = school.trim();
    if (location)   patch.location   = location;

    const { data, error } = await supabase
      .from('users')
      .update(patch)
      .eq('email', email.toLowerCase().trim())
      .select('id, name, email, role, grade, school, curriculum, location, onboarding_complete')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({
      id:                 data.id,
      name:               data.name,
      email:              data.email,
      role:               data.role,
      grade:              data.grade,
      school:             data.school,
      curriculum:         data.curriculum,
      location:           data.location,
      onboardingComplete: data.onboarding_complete,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /user/upload-photo ──────────────────────────────
// Uploads a profile photo to Cloudinary and saves URL to users table
// Body: { userEmail, base64, mimeType }

router.post('/upload-photo', async (req, res) => {
  try {
    const { userEmail, base64, mimeType = 'image/jpeg' } = req.body;
    if (!userEmail) return res.status(400).json({ error: 'userEmail required' });
    if (!base64)    return res.status(400).json({ error: 'base64 image required' });

    const dataUri = `data:${mimeType};base64,${base64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder:         'aivorah/profiles',
      public_id:      userEmail.replace(/[@.]/g, '_'),
      overwrite:      true,
      transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
    });

    const photoUrl = result.secure_url;
    await supabase.from('users').update({ photo_url: photoUrl }).eq('email', userEmail.toLowerCase().trim());

    res.json({ photoUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
