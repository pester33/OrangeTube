// Supabase connection — the publishable key is safe to ship in the browser.
// Row Level Security (see supabase/schema.sql) is what protects the data.
export const SUPABASE_URL = 'https://yxmzgjaoqcwryykzvvnc.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_2PjfXcK9gHfCdJ1YlmRXyQ_AEqxz7e7';

// Biggest video (in MB) the site will try to upload. Must match the
// "Upload file size limit" in Supabase → Storage → Settings (free plan max = 50).
export const MAX_UPLOAD_MB = 50;
