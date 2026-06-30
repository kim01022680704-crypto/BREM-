const BAEMIN_ORIGIN = 'https://deliverycenter.baemin.com';
const BAEMIN_API_ORIGIN = 'https://api-deliverycenter.baemin.com';
const BAEMIN_BETA_ORIGIN = 'https://deliverycenter.betabaemin.com';

const DELIVERY_CENTER_HOSTS = [
  'deliverycenter.baemin.com',
  'deliverycenter.betabaemin.com'
];

function isDeliveryCenterHost(url) {
  const text = String(url || '').toLowerCase();
  return DELIVERY_CENTER_HOSTS.some(host => text.includes(host));
}

function isBetaDeliveryCenterHost(url) {
  return String(url || '').toLowerCase().includes('deliverycenter.betabaemin.com');
}

function normalizeToProductionDeliveryUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (!parsed.hostname.includes('betabaemin.com')) {
      return parsed.toString();
    }
    parsed.hostname = 'deliverycenter.baemin.com';
    return parsed.toString();
  } catch {
    return String(url || '');
  }
}

module.exports = {
  BAEMIN_ORIGIN,
  BAEMIN_API_ORIGIN,
  BAEMIN_BETA_ORIGIN,
  DELIVERY_CENTER_HOSTS,
  isDeliveryCenterHost,
  isBetaDeliveryCenterHost,
  normalizeToProductionDeliveryUrl
};
