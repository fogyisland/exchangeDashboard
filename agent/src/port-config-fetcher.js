import axios from 'axios';
export async function fetchPortConfig({ baseUrl, configPath }) {
  const r = await axios.get(baseUrl.replace(/\/$/, '') + configPath, { timeout: 5000 });
  return r.data;
}