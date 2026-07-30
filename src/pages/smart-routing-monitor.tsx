import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined'
import {
  Box,
  IconButton,
  Paper,
  ThemeProvider,
  Typography,
} from '@mui/material'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useMemo } from 'react'

import { BaseLoading } from '@/components/base'
import { RoutingMonitor } from '@/components/smart-routing/routing-monitor'
import { useThemeMode } from '@/services/states'

import { useCustomTheme } from './_layout/hooks'

const SmartRoutingMonitorPage = () => {
  const mode = useThemeMode()
  const { theme } = useCustomTheme()
  const appWindow = useMemo(() => getCurrentWebviewWindow(), [])

  if (!theme) {
    return (
      <Box
        sx={{
          alignItems: 'center',
          bgcolor: mode === 'light' ? '#fff' : '#181a1b',
          color: mode === 'light' ? '#333' : '#fff',
          display: 'flex',
          height: '100vh',
          justifyContent: 'center',
          width: '100vw',
        }}
      >
        <BaseLoading />
      </Box>
    )
  }

  return (
    <ThemeProvider theme={theme}>
      <Paper
        square
        elevation={0}
        sx={{
          bgcolor: 'background.default',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'hidden',
          width: '100vw',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            bgcolor: 'background.paper',
            borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
            display: 'flex',
            flexShrink: 0,
            gap: 1,
            px: 1.5,
            py: 1,
          }}
        >
          <Typography sx={{ flex: 1, fontSize: 14, fontWeight: 700 }}>
            智能分流走向
          </Typography>
          <IconButton
            size="small"
            title="隐藏"
            onClick={() => void appWindow.hide()}
          >
            <VisibilityOffOutlinedIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', p: 1 }}>
          <RoutingMonitor />
        </Box>
      </Paper>
    </ThemeProvider>
  )
}

export default SmartRoutingMonitorPage
