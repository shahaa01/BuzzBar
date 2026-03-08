export type AdminSettings = {
  _id: string;
  nightHours: { start: string; end: string; timezone: string };
  serviceAreas: string[];
  deliveryFeeFlat: number;
  legalAgeMin: number;
  createdAt: string;
  updatedAt: string;
};

