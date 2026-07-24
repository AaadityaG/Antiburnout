import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSelector, useDispatch } from 'react-redux'
import type { RootState, AppDispatch } from '../store'
import { fetchKBDocuments, uploadKBDocument, deleteKBDocument } from '../store/kbSlice'
import ConfirmDialog from './ConfirmDialog'

const FILE_TYPE_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  pdf: { icon: 'PDF', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  txt: { icon: 'TXT', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
  md: { icon: 'MD', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
}

interface KnowledgeBaseProps {
  onBack?: () => void
}

function KnowledgeBase({ onBack }: KnowledgeBaseProps) {
  const dispatch = useDispatch<AppDispatch>()
  const { token } = useSelector((state: RootState) => state.auth)
  const { documents, isLoading, isUploading } = useSelector((state: RootState) => state.kb)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    docId: string
    filename: string
  }>({ isOpen: false, docId: '', filename: '' })

  useEffect(() => {
    if (token) {
      dispatch(fetchKBDocuments(token))
    }
  }, [token, dispatch])

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !token) return

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['pdf', 'txt', 'md'].includes(ext || '')) {
      alert('Only PDF, TXT, and MD files are supported.')
      return
    }

    dispatch(uploadKBDocument({ token, file }))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file || !token) return

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['pdf', 'txt', 'md'].includes(ext || '')) {
      alert('Only PDF, TXT, and MD files are supported.')
      return
    }

    dispatch(uploadKBDocument({ token, file }))
  }

  const handleDelete = (docId: string, filename: string) => {
    setConfirmDialog({ isOpen: true, docId, filename })
  }

  const confirmDelete = () => {
    if (!token) return
    dispatch(deleteKBDocument({ token, docId: confirmDialog.docId }))
    setConfirmDialog({ isOpen: false, docId: '', filename: '' })
  }

  const formatFileSize = (doc: any) => {
    const chunks = doc.total_chunks
    const pages = doc.page_count
    const parts = []
    if (pages > 1) parts.push(`${pages} pages`)
    parts.push(`${chunks} chunk${chunks !== 1 ? 's' : ''}`)
    return parts.join(' · ')
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 cursor-pointer transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div>
            <h3 className="text-sm font-medium text-white/80">Knowledge Base</h3>
            <p className="text-[11px] text-white/30">
              {documents.length} document{documents.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md"
          className="hidden"
          onChange={handleUpload}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent/10 border border-accent/20 text-accent text-sm font-medium hover:bg-accent/20 cursor-pointer transition-all disabled:opacity-50"
        >
          {isUploading ? (
            <>
              <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Upload
            </>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          </div>
        ) : documents.length === 0 ? (
          <div
            className={`h-full flex flex-col items-center justify-center text-center px-8 transition-colors ${
              isDragOver ? 'bg-accent/5' : ''
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-5 transition-all ${
              isDragOver
                ? 'bg-accent/20 border-2 border-dashed border-accent/40 scale-110'
                : 'bg-white/[0.03] border border-white/[0.06]'
            }`}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-white/20">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <h3 className="text-lg font-light text-white/60 mb-2">No documents yet</h3>
            <p className="text-sm text-white/25 max-w-xs leading-relaxed mb-6">
              Upload PDFs, text files, or markdown notes. The AI will search them when you chat.
            </p>
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="px-6 py-3 rounded-xl bg-accent/15 border border-accent/25 text-accent text-sm font-medium hover:bg-accent/25 cursor-pointer transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {isUploading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    Upload Document
                  </>
                )}
              </button>
              <p className="text-[11px] text-white/15">or drag and drop a file here</p>
            </div>
            <div className="mt-8 flex items-center gap-4">
              {[
                { type: 'PDF', color: 'text-red-400/40' },
                { type: 'TXT', color: 'text-blue-400/40' },
                { type: 'MD', color: 'text-purple-400/40' },
              ].map(({ type, color }) => (
                <span key={type} className={`text-[10px] font-mono ${color} border border-white/[0.04] rounded px-2 py-1`}>
                  .{type.toLowerCase()}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div
            className={`p-5 transition-colors ${isDragOver ? 'bg-accent/5' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="space-y-2">
              {documents.map((doc, index) => {
                const typeConfig = FILE_TYPE_CONFIG[doc.file_type] || FILE_TYPE_CONFIG.txt
                return (
                  <motion.div
                    key={doc.doc_id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: index * 0.03 }}
                    className="group relative flex items-center gap-4 px-4 py-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.1] transition-all"
                  >
                    {/* File type badge */}
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${typeConfig.bg}`}>
                      <span className={`text-[10px] font-bold tracking-wider ${typeConfig.color}`}>
                        {typeConfig.icon}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate text-white/70">
                          {doc.filename}
                        </p>
                      </div>
                      <p className="text-[11px] text-white/25 mt-1">
                        {formatFileSize(doc)}
                      </p>
                    </div>

                    {/* Delete button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(doc.doc_id, doc.filename)
                      }}
                      className="opacity-0 group-hover:opacity-100 w-8 h-8 rounded-lg flex items-center justify-center text-red-400/40 hover:text-red-300 hover:bg-red-500/10 cursor-pointer transition-all shrink-0"
                      title="Delete document"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                    </button>
                  </motion.div>
                )
              })}
            </div>

            {/* Drop overlay */}
            <AnimatePresence>
              {isDragOver && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-bg-dark/80 backdrop-blur-sm pointer-events-none"
                >
                  <div className="px-8 py-6 rounded-2xl border-2 border-dashed border-accent/40 bg-accent/5">
                    <p className="text-accent text-lg font-medium">Drop file to upload</p>
                    <p className="text-accent/50 text-sm mt-1">PDF, TXT, or MD</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Footer info */}
            <div className="mt-6 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <p className="text-[11px] text-white/20 leading-relaxed">
                Documents are indexed for semantic search. The AI automatically searches your knowledge base when you ask questions in chat.
              </p>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title="Delete Document"
        message={`Are you sure you want to delete "${confirmDialog.filename}"? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        confirmVariant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDialog({ isOpen: false, docId: '', filename: '' })}
      />
    </div>
  )
}

export default KnowledgeBase
