import { createBrowserRouter, RouteObject } from 'react-router'

import Layout from './_layout'
import { navItems } from './_navigation'
import SmartRoutingMonitorPage from './smart-routing-monitor'

const isSmartRoutingMonitorWindow =
  new URLSearchParams(window.location.search).get('window') ===
  'smart-routing-monitor'

export const router = createBrowserRouter(
  isSmartRoutingMonitorWindow
    ? [
        {
          path: '/',
          Component: SmartRoutingMonitorPage,
        },
      ]
    : [
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
      ],
)
