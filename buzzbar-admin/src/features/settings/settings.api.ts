import { api } from '../../lib/api/client.js';
import type { AdminSettings } from './settings.types.js';

export async function adminGetSettings() {
  const res = await api.get('/api/v1/admin/settings');
  return res.data?.data as AdminSettings;
}

export type SettingsPatch = Partial<Pick<AdminSettings, 'nightHours' | 'serviceAreas' | 'deliveryFeeFlat' | 'legalAgeMin'>>;

export async function adminUpdateSettings(patch: SettingsPatch) {
  const res = await api.put('/api/v1/admin/settings', patch);
  return res.data?.data as AdminSettings;
}

