require('dotenv').config();

const base = process.env.POCKETFI_BASE_URL;
const keys = {
  'POCKETFI_SECRET_KEY': process.env.POCKETFI_SECRET_KEY,
  'POCKETFI_PUBLIC_KEY': process.env.POCKETFI_PUBLIC_KEY,
};

(async () => {
  for (const [name, key] of Object.entries(keys)) {
    const res = await fetch(`${base}/virtual-accounts/create`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: '{}',
    });
    console.log(name, res.status, (await res.text()).slice(0, 200));
  }
})();