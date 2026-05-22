async function check() {
  const res = await fetch('https://smartprintvit.web.app');
  const text = await res.text();
  const match = text.match(/src="(\/assets\/index-[^"]+\.js)"/);
  if (match) {
    const jsUrl = 'https://smartprintvit.web.app' + match[1];
    console.log('JS URL:', jsUrl);
    const jsRes = await fetch(jsUrl);
    const jsText = await jsRes.text();
    console.log('Contains system_settings:', jsText.includes('system_settings'));
    console.log('Contains fetchSettings:', jsText.includes('fetchSettings'));
    console.log('Contains /api/settings:', jsText.includes('/api/settings'));
  }
}
check();
