const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');

// GET /v/:code — redirect to the full URL stored for this short code
router.get('/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const { data, error } = await supabase
      .from('short_links')
      .select('url, expires_at')
      .eq('code', code)
      .maybeSingle();

    if (error || !data) return res.status(404).send('Link not found or expired.');

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return res.status(410).send('This link has expired.');
    }

    res.redirect(data.url);
  } catch (err) {
    res.status(500).send('Server error.');
  }
});

module.exports = router;
