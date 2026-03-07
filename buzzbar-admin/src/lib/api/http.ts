import axios from 'axios';
import { getApiBaseUrl } from '../utils/env.js';

const baseURL = getApiBaseUrl();

export const authHttp = axios.create({
  baseURL
});

export const apiHttp = axios.create({
  baseURL
});

