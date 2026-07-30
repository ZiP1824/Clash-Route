import { createBrowserRouter, RouteObject } from 'react-router'

import Layout from './_layout'
import { navItems } from './_navigation'
import SmartRoutingMonitorPage from './smart-routing-monitor'

export const router = createBrowserRouter([
  {
    path: '/smart-routing-monitor',
    Component: SmartRoutingMonitorPage,
  },
  {
    path: '/',
    Component: Layout,
    children: navItems.map(
      (item) =>
        ({
          path: item.path,
          Component: item.Component,
        }) as RouteObject,
    ),
  },
])
