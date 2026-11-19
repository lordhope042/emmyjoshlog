export const sampleUser = {
  fullName: 'Hope Okechukwu',
  email: 'hope.oke@example.test',
  phoneNumber: '+234 810 123 4567',
};

export const sampleProducts = [
  {
    id: 'demo-audit-export', slug: 'audit-export', name: 'Instagram Logs · Example', platform: 'Instagram',
    category: 'Logs', categorySlug: 'logs', description: 'Illustrative authorized social-account listing. No real account credentials are supplied in preview.',
    price: 3000, currency: 'NGN', rating: null, reviews: 0, available: null, icon: 'file', tag: 'Example only',
  },
  {
    id: 'demo-retention-pack', slug: 'retention-pack', name: 'Facebook Logs · Example', platform: 'Facebook',
    category: 'Logs', categorySlug: 'logs', description: 'An example Facebook account listing for the interface. Availability and transfer authorization must be verified.',
    price: 4500, currency: 'NGN', rating: null, reviews: 0, available: null, icon: 'file', tag: 'Example only',
  },
  {
    id: 'demo-number-us', slug: 'virtual-number-us', name: 'Virtual Number (US)',
    category: 'Virtual Numbers', categorySlug: 'virtual-numbers', description: 'A virtual number service for legitimate communication and account workflows where permitted.',
    price: 3500, currency: 'NGN', rating: 4.7, reviews: 86, available: true, icon: 'phone', tag: 'Instant setup',
  },
  {
    id: 'demo-number-uk', slug: 'virtual-number-uk', name: 'Virtual Number (UK)',
    category: 'Virtual Numbers', categorySlug: 'virtual-numbers', description: 'A virtual number service with clear eligibility and usage terms.',
    price: 4200, currency: 'NGN', rating: 4.6, reviews: 54, available: true, icon: 'phone', tag: 'New',
  },
  {
    id: 'demo-compliance-report', slug: 'compliance-log-report', name: 'TikTok Logs · Example', platform: 'TikTok',
    category: 'Logs', categorySlug: 'logs', description: 'Preview account listing only. This product does not deliver any working account or credentials.',
    price: 5200, currency: 'NGN', rating: null, reviews: 0, available: false, icon: 'file', tag: 'Example only',
  },
  {
    id: 'demo-number-ca', slug: 'virtual-number-ca', name: 'Virtual Number (CA)',
    category: 'Virtual Numbers', categorySlug: 'virtual-numbers', description: 'A virtual number option for supported and permitted use cases.',
    price: 3900, currency: 'NGN', rating: 4.5, reviews: 42, available: true, icon: 'phone', tag: 'Available',
  },
];

export const sampleOrders = [
  { reference: 'EJL-DEMO-2041', product: 'Audit Log Export', date: 'Oct 25, 2026 · 2:30 PM', amount: 3000, status: 'Completed', type: 'Logs' },
  { reference: 'EJL-DEMO-2038', product: 'Virtual Number (US)', date: 'Oct 20, 2026 · 11:15 AM', amount: 3500, status: 'Processing', type: 'Virtual Numbers' },
];

export const sampleTransactions = [
  { reference: 'DEP-DEMO-0201', type: 'Deposit via Bank Transfer', date: 'Oct 25, 2026 · 1:20 PM', amount: 10000, direction: 'in', status: 'Example' },
  { reference: 'EJL-DEMO-2041', type: 'Purchase · Audit Log Export', date: 'Oct 25, 2026 · 2:30 PM', amount: 3000, direction: 'out', status: 'Example' },
  { reference: 'DEP-DEMO-0182', type: 'Deposit via USSD', date: 'Oct 20, 2026 · 10:45 AM', amount: 5000, direction: 'in', status: 'Example' },
];

export const sampleNotifications = [
  { id: 'sample-1', icon: 'bag', title: 'Your example order is ready', body: 'This is preview content. Live order status will come from the server.', time: '2m ago', read: false, tone: 'orange' },
  { id: 'sample-2', icon: 'wallet', title: 'Deposit status example', body: 'No real deposit has been received or credited in preview mode.', time: '5m ago', read: false, tone: 'green' },
  { id: 'sample-3', icon: 'megaphone', title: 'A clearer marketplace', body: 'Product availability and service terms will be shown before checkout.', time: '1h ago', read: true, tone: 'brown' },
];

export const sampleAdmin = {
  customers: [
    { name: 'Hope Okechukwu', email: 'hope.oke@example.test', status: 'Active', balance: 12500 },
    { name: 'Ada Eze', email: 'ada.eze@example.test', status: 'Active', balance: 8000 },
    { name: 'Chidi Nwosu', email: 'chidi.nwosu@example.test', status: 'Review', balance: 2500 },
  ],
  events: [
    { action: 'Product availability reviewed', actor: 'Admin preview', date: 'Nov 14, 2026 · 09:42 AM' },
    { action: 'Support queue opened', actor: 'Admin preview', date: 'Nov 14, 2026 · 09:30 AM' },
    { action: 'Example order status changed', actor: 'Admin preview', date: 'Nov 13, 2026 · 04:10 PM' },
  ],
};

export const formatNaira = (amount = 0) => `₦${Number(amount).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

export function formatMinorNaira(minor) {
  try {
    const amount = BigInt(String(minor));
    if (amount < 0n) return 'Price unavailable';
    const naira = amount / 100n;
    const kobo = (amount % 100n).toString().padStart(2, '0');
    return `₦${new Intl.NumberFormat('en-NG').format(naira)}.${kobo}`;
  } catch { return 'Price unavailable'; }
}
