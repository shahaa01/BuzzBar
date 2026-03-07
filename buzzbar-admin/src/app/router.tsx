import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AuthLayout } from '../layouts/AuthLayout.js';
import { AppShellLayout } from '../layouts/AppShellLayout.js';
import { LoginPage } from '../features/auth/LoginPage.js';
import { UnauthorizedPage } from '../routes/UnauthorizedPage.js';
import { NotFoundPage } from '../routes/NotFoundPage.js';
import { DashboardPage } from '../features/dashboard/DashboardPage.js';
import { OrdersPage } from '../features/orders/OrdersPage.js';
import { KycPage } from '../features/kyc/KycPage.js';
import { InventoryPage } from '../features/inventory/InventoryPage.js';
import { PaymentsPage } from '../features/payments/PaymentsPage.js';
import { CatalogPage } from '../features/catalog/CatalogPage.js';
import { SettingsPage } from '../features/settings/SettingsPage.js';
import { PromotionsPage } from '../features/promotions/PromotionsPage.js';
import { RequireAuth } from '../routes/RequireAuth.js';
import { RequireCapability } from '../routes/RequireCapability.js';

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/unauthorized', element: <UnauthorizedPage /> }
    ]
  },
  {
    element: (
      <RequireAuth>
        <AppShellLayout />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <Navigate to="/dashboard" replace /> },
      {
        path: '/dashboard',
        element: (
          <RequireCapability capability="dashboard">
            <DashboardPage />
          </RequireCapability>
        ),
        handle: { title: 'Dashboard' }
      },
      {
        path: '/orders',
        element: (
          <RequireCapability capability="orders">
            <OrdersPage />
          </RequireCapability>
        ),
        handle: { title: 'Orders' }
      },
      {
        path: '/kyc',
        element: (
          <RequireCapability capability="kyc">
            <KycPage />
          </RequireCapability>
        ),
        handle: { title: 'KYC' }
      },
      {
        path: '/inventory',
        element: (
          <RequireCapability capability="inventory">
            <InventoryPage />
          </RequireCapability>
        ),
        handle: { title: 'Inventory' }
      },
      {
        path: '/payments',
        element: (
          <RequireCapability capability="payments">
            <PaymentsPage />
          </RequireCapability>
        ),
        handle: { title: 'Payments' }
      },
      {
        path: '/catalog',
        element: (
          <RequireCapability capability="catalog">
            <CatalogPage />
          </RequireCapability>
        ),
        handle: { title: 'Catalog' }
      },
      {
        path: '/settings',
        element: (
          <RequireCapability capability="settings_read">
            <SettingsPage />
          </RequireCapability>
        ),
        handle: { title: 'Settings' }
      },
      {
        path: '/promotions',
        element: (
          <RequireCapability capability="dashboard">
            <PromotionsPage />
          </RequireCapability>
        ),
        handle: { title: 'Promotions' }
      },
      { path: '*', element: <NotFoundPage /> }
    ]
  }
]);
