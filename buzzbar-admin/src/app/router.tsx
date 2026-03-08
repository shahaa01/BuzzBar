import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AuthLayout } from '../layouts/AuthLayout.js';
import { AppShellLayout } from '../layouts/AppShellLayout.js';
import { UnauthorizedPage } from '../routes/UnauthorizedPage.js';
import { NotFoundPage } from '../routes/NotFoundPage.js';
import { RequireAuth } from '../routes/RequireAuth.js';
import { RequireCapability } from '../routes/RequireCapability.js';
import { HomeRedirect } from '../routes/HomeRedirect.js';
import { loadNamedPage } from './route-loader.js';
import { RouteSuspense } from './route-suspense.js';

const LoginPage = loadNamedPage(() => import('../features/auth/LoginPage.js'), 'LoginPage');
const DashboardPage = loadNamedPage(() => import('../features/dashboard/DashboardPage.js'), 'DashboardPage');
const OrdersPage = loadNamedPage(() => import('../features/orders/OrdersPage.js'), 'OrdersPage');
const OrderDetailPage = loadNamedPage(() => import('../features/orders/OrderDetailPage.js'), 'OrderDetailPage');
const KycPage = loadNamedPage(() => import('../features/kyc/KycPage.js'), 'KycPage');
const KycReviewPage = loadNamedPage(() => import('../features/kyc/KycReviewPage.js'), 'KycReviewPage');
const InventoryPage = loadNamedPage(() => import('../features/inventory/InventoryPage.js'), 'InventoryPage');
const PaymentsPage = loadNamedPage(() => import('../features/payments/PaymentsPage.js'), 'PaymentsPage');
const PaymentDetailPage = loadNamedPage(() => import('../features/payments/PaymentDetailPage.js'), 'PaymentDetailPage');
const CatalogLayout = loadNamedPage(() => import('../features/catalog/CatalogLayout.js'), 'CatalogLayout');
const CatalogProductsPage = loadNamedPage(() => import('../features/catalog/products/CatalogProductsPage.js'), 'CatalogProductsPage');
const CatalogProductDetailPage = loadNamedPage(() => import('../features/catalog/products/CatalogProductDetailPage.js'), 'CatalogProductDetailPage');
const CatalogProductNewPage = loadNamedPage(() => import('../features/catalog/products/CatalogProductNewPage.js'), 'CatalogProductNewPage');
const CategoriesPage = loadNamedPage(() => import('../features/catalog/categories/CategoriesPage.js'), 'CategoriesPage');
const BrandsPage = loadNamedPage(() => import('../features/catalog/brands/BrandsPage.js'), 'BrandsPage');
const SettingsPage = loadNamedPage(() => import('../features/settings/SettingsPage.js'), 'SettingsPage');
const PromotionsPage = loadNamedPage(() => import('../features/promotions/PromotionsPage.js'), 'PromotionsPage');
const PromotionDetailPage = loadNamedPage(() => import('../features/promotions/PromotionDetailPage.js'), 'PromotionDetailPage');
const PromotionNewPage = loadNamedPage(() => import('../features/promotions/PromotionNewPage.js'), 'PromotionNewPage');

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: <RouteSuspense><LoginPage /></RouteSuspense> },
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
      { path: '/', element: <HomeRedirect /> },
      {
        path: '/dashboard',
        element: (
          <RequireCapability capability="dashboard">
            <RouteSuspense><DashboardPage /></RouteSuspense>
          </RequireCapability>
        ),
        handle: { title: 'Dashboard' }
      },
      {
        path: '/orders',
        element: (
          <RequireCapability capability="orders">
            <RouteSuspense><OrdersPage /></RouteSuspense>
          </RequireCapability>
        ),
        handle: { title: 'Orders' }
      },
      {
        path: '/orders/:id',
        element: (
          <RequireCapability capability="orders">
            <RouteSuspense><OrderDetailPage /></RouteSuspense>
          </RequireCapability>
        ),
        handle: { title: 'Order' }
      },
      {
        path: '/kyc',
        element: (
          <RequireCapability capability="kyc">
            <RouteSuspense><KycPage /></RouteSuspense>
          </RequireCapability>
        ),
        handle: { title: 'KYC' }
      },
      {
        path: '/kyc/:userId',
        element: (
          <RequireCapability capability="kyc">
            <RouteSuspense><KycReviewPage /></RouteSuspense>
          </RequireCapability>
        ),
        handle: { title: 'KYC Review' }
      },
      {
        path: '/inventory',
        element: (
          <RequireCapability capability="inventory_edit">
            <RouteSuspense><InventoryPage /></RouteSuspense>
          </RequireCapability>
        ),
        handle: { title: 'Inventory' }
      },
      {
        path: '/payments',
        element: (
          <RequireCapability capability="payments_read">
            <RouteSuspense><PaymentsPage /></RouteSuspense>
          </RequireCapability>
        ),
        handle: { title: 'Payments' }
      },
      {
        path: '/payments/:id',
        element: (
          <RequireCapability capability="payments_read">
            <RouteSuspense><PaymentDetailPage /></RouteSuspense>
          </RequireCapability>
        ),
        handle: { title: 'Payment Detail' }
      },
      {
        path: '/catalog',
        element: (
          <RequireCapability anyOf={['catalog', 'catalog_products_read']}>
            <RouteSuspense><CatalogLayout /></RouteSuspense>
          </RequireCapability>
        ),
        handle: { title: 'Catalog' },
        children: [
          { index: true, element: <Navigate to="/catalog/products" replace /> },
          { path: 'products', element: <RouteSuspense><CatalogProductsPage /></RouteSuspense>, handle: { title: 'Catalog · Products' } },
          {
            path: 'products/new',
            element: (
              <RequireCapability capability="catalog">
                <RouteSuspense><CatalogProductNewPage /></RouteSuspense>
              </RequireCapability>
            ),
            handle: { title: 'Catalog · New Product' }
          },
          { path: 'products/:id', element: <RouteSuspense><CatalogProductDetailPage /></RouteSuspense>, handle: { title: 'Catalog · Product' } },
          {
            path: 'categories',
            element: (
              <RequireCapability capability="catalog">
                <RouteSuspense><CategoriesPage /></RouteSuspense>
              </RequireCapability>
            ),
            handle: { title: 'Catalog · Categories' }
          },
          {
            path: 'brands',
            element: (
              <RequireCapability capability="catalog">
                <RouteSuspense><BrandsPage /></RouteSuspense>
              </RequireCapability>
            ),
            handle: { title: 'Catalog · Brands' }
          }
        ]
      },
      {
        path: '/settings',
        element: (
          <RequireCapability capability="settings_read">
            <RouteSuspense><SettingsPage /></RouteSuspense>
          </RequireCapability>
        ),
        handle: { title: 'Settings' }
      },
      {
        path: '/promotions',
        element: (
          <RequireCapability capability="promotions_read">
            <RouteSuspense><PromotionsPage /></RouteSuspense>
          </RequireCapability>
        ),
        handle: { title: 'Promotions' }
      },
      {
        path: '/promotions/:id',
        element: (
          <RequireCapability capability="promotions_read">
            <RouteSuspense><PromotionDetailPage /></RouteSuspense>
          </RequireCapability>
        ),
        handle: { title: 'Promotion Detail' }
      },
      {
        path: '/promotions/new',
        element: (
          <RequireCapability capability="promotions_manage">
            <RouteSuspense><PromotionNewPage /></RouteSuspense>
          </RequireCapability>
        ),
        handle: { title: 'New Promotion' }
      },
      { path: '*', element: <NotFoundPage /> }
    ]
  }
]);
