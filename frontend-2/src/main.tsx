import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import 'antd/dist/reset.css'
import './index.css'
import App from './App.tsx'

const theme = {
  token: {
    colorPrimary: '#1B4DFF',
    colorInfo: '#1B4DFF',
    borderRadius: 8,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: 14,
    colorBgContainer: '#FFFFFF',
    colorBgLayout: '#F5F6FA',
    colorBorder: '#E5E7EB',
    colorBorderSecondary: '#F0F1F3',
    controlHeight: 36,
    colorText: '#111827',
    colorTextSecondary: '#6B7280',
    colorTextTertiary: '#9CA3AF',
    lineHeight: 1.5,
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
    boxShadowSecondary: '0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
  },
  components: {
    Table: {
      headerBg: '#F9FAFB',
      headerColor: '#6B7280',
      rowHoverBg: '#F0F4FF',
      borderColor: '#F0F1F3',
      headerBorderRadius: 8,
    },
    Card: {
      headerFontSize: 16,
      paddingLG: 20,
    },
    Button: {
      primaryShadow: '0 2px 4px rgba(27, 77, 255, 0.2)',
      controlHeight: 36,
    },
    Input: {
      controlHeight: 36,
    },
    Select: {
      controlHeight: 36,
    },
    Menu: {
      darkItemBg: 'transparent',
      darkSubMenuItemBg: 'transparent',
      darkItemSelectedBg: 'rgba(27, 77, 255, 0.15)',
      darkItemColor: '#94A3B8',
      darkItemHoverColor: '#E2E8F0',
      darkItemSelectedColor: '#FFFFFF',
      darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
      itemBorderRadius: 8,
      itemMarginInline: 8,
      iconMarginInlineEnd: 12,
    },
    Layout: {
      siderBg: '#0F172A',
      bodyBg: '#F5F6FA',
    },
  },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider theme={theme}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </StrictMode>,
)
