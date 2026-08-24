import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { Button, Card, Layout, Space, Typography, Upload, message } from 'antd'
import { useMemo, useState } from 'react'
import CompanySidebar from '../../../../components/company/sidebar.jsx'
import AppShell from '../../../../components/layout/AppShell.jsx'
import PageHeader from '../../../../components/common/PageHeader.jsx'

const { Content } = Layout
const { Title, Text } = Typography

function pickFirstUploadedFile(fileList) {
  if (!Array.isArray(fileList) || !fileList.length) return null
  const latest = fileList[fileList.length - 1]
  return latest?.originFileObj || null
}

async function downloadBlobResponse(res, fallbackName) {
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function CompanyAdminDgftExcelPage() {
  const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '')

  const [fileList, setFileList] = useState([])
  const [submittingEndpoint, setSubmittingEndpoint] = useState('')
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)
  const [lastResponse, setLastResponse] = useState(null)

  const selectedFile = useMemo(() => pickFirstUploadedFile(fileList), [fileList])

  const sendExcel = async (endpoint) => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    if (!selectedFile) {
      message.error('Please choose an Excel file first.')
      return
    }

    setSubmittingEndpoint(endpoint)
    setLastResponse(null)
    try {
      const form = new FormData()
      // Backend accepts any one of these names; send all aliases for compatibility.
      form.append('excel', selectedFile)
      form.append('file', selectedFile)
      form.append('excelFile', selectedFile)

      const res = await fetch(`${BACKEND_URL}/api/company/admin/dgft/${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail || data?.message || `Request failed (${res.status})`)
      }
      setLastResponse(data)
      message.success(data?.message || 'Excel file uploaded successfully.')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to upload Excel file')
    } finally {
      setSubmittingEndpoint('')
    }
  }

  const handleDownloadTemplate = async () => {
    if (!BACKEND_URL) {
      message.error('Backend URL is not configured (VITE_BACKEND_URL).')
      return
    }
    setDownloadingTemplate(true)
    try {
      const res = await fetch(`${BACKEND_URL}/api/company/admin/dgft/excel-template`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson?.detail || errJson?.message || `Template download failed (${res.status})`)
      }
      await downloadBlobResponse(res, 'dgft-template.xlsx')
      message.success('Template download started.')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to download template')
    } finally {
      setDownloadingTemplate(false)
    }
  }

  return (
    <AppShell sidebar={<CompanySidebar />}>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Title level={3} style={{ margin: 0 }}>
                DGFT Excel Upload
              </Title>
              <Text type="secondary">
                Upload an Excel file for DGFT processing using either endpoint, or download the Excel template.
              </Text>
            </div>

            <Card size="small">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Upload
                  accept=".xlsx,.xls,.csv"
                  fileList={fileList}
                  maxCount={1}
                  beforeUpload={() => false}
                  onChange={({ fileList: next }) => setFileList(next)}
                >
                  <Button icon={<UploadOutlined />}>Choose Excel File</Button>
                </Upload>

                <Space wrap>
                  <Button
                    type="primary"
                    loading={submittingEndpoint === 'excel-process-data'}
                    disabled={!selectedFile || Boolean(submittingEndpoint)}
                    onClick={() => sendExcel('excel-process-data')}
                  >
                    Upload via excel-process-data
                  </Button>
                  <Button
                    loading={submittingEndpoint === 'excel-upload'}
                    disabled={!selectedFile || Boolean(submittingEndpoint)}
                    onClick={() => sendExcel('excel-upload')}
                  >
                    Upload via excel-upload
                  </Button>
                  <Button
                    icon={<DownloadOutlined />}
                    loading={downloadingTemplate}
                    disabled={Boolean(submittingEndpoint)}
                    onClick={handleDownloadTemplate}
                  >
                    Download Template
                  </Button>
                </Space>
              </Space>
            </Card>

            {lastResponse ? (
              <div>
                <Text strong>Response</Text>
                <pre
                  style={{
                    marginTop: 8,
                    background: '#fafafa',
                    border: '1px solid #f0f0f0',
                    borderRadius: 8,
                    padding: 12,
                    overflowX: 'auto',
                    wordBreak: 'break-word',
                  }}
                >
                  {JSON.stringify(lastResponse, null, 2)}
                </pre>
              </div>
            ) : null}
          </Space>
        </AppShell>
  )
}
