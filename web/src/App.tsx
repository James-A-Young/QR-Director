import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { ApiError } from './lib/api';
import { ToastProvider } from './components/ui';
import { AppLayout, RequireAuth } from './components/AppLayout';
import { lazy } from 'react';
import { LoginPage } from './pages/LoginPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Chart- and designer-heavy pages load on demand to keep the initial bundle small.
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const CampaignPage = lazy(() => import('./pages/CampaignPage').then((m) => ({ default: m.CampaignPage })));
const LinkDesignerPage = lazy(() => import('./pages/LinkDesignerPage').then((m) => ({ default: m.LinkDesignerPage })));
const TemplateEditorPage = lazy(() => import('./pages/TemplateEditorPage').then((m) => ({ default: m.TemplateEditorPage })));

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'campaigns', element: <CampaignsPage /> },
      { path: 'campaigns/:id', element: <CampaignPage /> },
      { path: 'links/:id/design', element: <LinkDesignerPage /> },
      { path: 'templates', element: <TemplatesPage /> },
      { path: 'templates/new', element: <TemplateEditorPage /> },
      { path: 'templates/:id', element: <TemplateEditorPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      },
    },
  });
}

const router = createBrowserRouter(routes, { basename: '/app' });
const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
