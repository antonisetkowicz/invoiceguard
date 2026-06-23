const { supabase } = require('../config/supabase');

async function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const token = authHeader.split(' ')[1];

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { data: dbUser } = await supabase
    .from('users')
    .select('*')
    .eq('supabase_auth_id', user.id)
    .single();

  if (!dbUser) {
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({ supabase_auth_id: user.id })
      .select()
      .single();

    if (createError) {
      return res.status(500).json({ error: 'Failed to create user profile' });
    }
    req.user = newUser;
  } else {
    req.user = dbUser;
  }

  req.authToken = token;
  next();
}

module.exports = { authenticateUser };
