module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  const cronSecret = process.env.CRON_SECRET;

  if (!supabaseUrl || !supabaseSecretKey || !cronSecret) {
    return res.status(500).json({
      ok: false,
      error: 'Server configuration missing'
    });
  }

  // Only cron-job.org should be allowed to call this endpoint.
  const providedSecret = req.headers['x-cron-secret'];

  if (providedSecret !== cronSecret) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized'
    });
  }

  try {
    // Small read-only request against an EXISTING table.
    // No data is inserted, updated, or deleted.
    const response = await fetch(
      `${supabaseUrl}/rest/v1/business_settings?select=user_id&limit=1`,
      {
        method: 'GET',
        headers: {
          apikey: supabaseSecretKey
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error('Supabase keep-alive failed:', errorText);

      return res.status(502).json({
        ok: false,
        error: 'Supabase request failed'
      });
    }

    return res.status(200).json({
      ok: true,
      message: 'Supabase keep-alive successful'
    });

  } catch (error) {
    console.error('Keep-alive error:', error);

    return res.status(500).json({
      ok: false,
      error: 'Keep-alive request failed'
    });
  }
};