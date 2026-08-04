import { GitHub } from '@mui/icons-material'
import { Box, ButtonGroup, IconButton, Grid, Typography } from '@mui/material'
import { version } from '@root/package.json'
import { useLockFn } from 'ahooks'
import { useTranslation } from 'react-i18next'

import { BasePage } from '@/components/base'
import SettingClash from '@/components/setting/setting-clash'
import SettingSystem from '@/components/setting/setting-system'
import SettingVergeAdvanced from '@/components/setting/setting-verge-advanced'
import SettingVergeBasic from '@/components/setting/setting-verge-basic'
import { openWebUrl } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { useThemeMode } from '@/services/states'

const AboutDevelopmentNotice = () => {
  const toDeveloperGithub = useLockFn(() => {
    return openWebUrl('https://github.com/ZiP1824')
  })

  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <Typography sx={{ fontSize: 16, fontWeight: 700, mb: 1 }}>
        开发声明
      </Typography>
      <Typography sx={{ fontSize: 13, lineHeight: 1.8 }}>
        Clash Route
        <br />
        版本：v{version}
        <br />
        开发人：ZiP1824
        <IconButton
          color="primary"
          onClick={toDeveloperGithub}
          size="small"
          sx={{ ml: 0.5, verticalAlign: 'middle' }}
          title="打开开发者 GitHub 主页"
        >
          <GitHub fontSize="inherit" />
        </IconButton>
        <br />
        Clash Route 是基于 Clash Verge Rev
        二次开发的非官方开源客户端，专注于可视化智能分流和多节点路由管理。本项目与
        Clash Verge Rev
        官方项目及其维护团队不存在隶属、授权、赞助或官方维护关系。
        <br />
        基于：Clash Verge Rev
        <br />
        内核：Mihomo
        <br />
        许可证：GNU General Public License v3.0 only
        <br />
        本软件按“现状”提供，不附带任何形式的担保。
      </Typography>
    </Box>
  )
}

const SettingPage = () => {
  const { t } = useTranslation()

  const onError = (err: any) => {
    showNotice.error(err)
  }

  const toGithubRepo = useLockFn(() => {
    return openWebUrl('https://github.com/ZiP1824/clash-route')
  })

  const mode = useThemeMode()
  const isDark = mode === 'light' ? false : true

  return (
    <BasePage
      title={t('settings.page.title')}
      header={
        <ButtonGroup variant="contained" aria-label="Basic button group">
          <IconButton
            size="medium"
            color="inherit"
            title={t('settings.page.actions.github')}
            onClick={toGithubRepo}
          >
            <GitHub fontSize="inherit" />
          </IconButton>
        </ButtonGroup>
      }
    >
      <Grid container spacing={1.5} columns={{ xs: 6, sm: 6, md: 12 }}>
        <Grid size={6}>
          <Box
            sx={{
              borderRadius: 2,
              marginBottom: 1.5,
              backgroundColor: isDark ? '#282a36' : '#ffffff',
            }}
          >
            <SettingSystem onError={onError} />
          </Box>
          <Box
            sx={{
              borderRadius: 2,
              marginBottom: 1.5,
              backgroundColor: isDark ? '#282a36' : '#ffffff',
            }}
          >
            <SettingClash onError={onError} />
          </Box>
          <Box
            sx={{
              borderRadius: 2,
              backgroundColor: isDark ? '#282a36' : '#ffffff',
            }}
          >
            <AboutDevelopmentNotice />
          </Box>
        </Grid>
        <Grid size={6}>
          <Box
            sx={{
              borderRadius: 2,
              marginBottom: 1.5,
              backgroundColor: isDark ? '#282a36' : '#ffffff',
            }}
          >
            <SettingVergeBasic onError={onError} />
          </Box>
          <Box
            sx={{
              borderRadius: 2,
              backgroundColor: isDark ? '#282a36' : '#ffffff',
            }}
          >
            <SettingVergeAdvanced onError={onError} />
          </Box>
        </Grid>
      </Grid>
    </BasePage>
  )
}

export default SettingPage
