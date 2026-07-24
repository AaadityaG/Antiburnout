import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL

export interface KBDocument {
  doc_id: string
  filename: string
  file_type: string
  page_count: number
  total_chunks: number
}

interface KBState {
  documents: KBDocument[]
  isLoading: boolean
  isUploading: boolean
  error: string | null
}

const initialState: KBState = {
  documents: [],
  isLoading: false,
  isUploading: false,
  error: null,
}

export const fetchKBDocuments = createAsyncThunk(
  'kb/fetchDocuments',
  async (token: string) => {
    const response = await axios.get(`${API_URL}/kb/documents`, {
      params: { token },
    })
    return response.data
  }
)

export const uploadKBDocument = createAsyncThunk(
  'kb/uploadDocument',
  async ({ token, file }: { token: string; file: File }) => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await axios.post(`${API_URL}/kb/upload`, formData, {
      params: { token },
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  }
)

export const deleteKBDocument = createAsyncThunk(
  'kb/deleteDocument',
  async ({ token, docId }: { token: string; docId: string }) => {
    await axios.delete(`${API_URL}/kb/documents/${docId}`, {
      params: { token },
    })
    return docId
  }
)

const kbSlice = createSlice({
  name: 'kb',
  initialState,
  reducers: {
    clearKBError: (state) => {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchKBDocuments.pending, (state) => {
        state.isLoading = true
        state.error = null
      })
      .addCase(fetchKBDocuments.fulfilled, (state, action) => {
        state.isLoading = false
        state.documents = action.payload
      })
      .addCase(fetchKBDocuments.rejected, (state, action) => {
        state.isLoading = false
        state.error = action.error.message || 'Failed to fetch documents'
      })
      .addCase(uploadKBDocument.pending, (state) => {
        state.isUploading = true
        state.error = null
      })
      .addCase(uploadKBDocument.fulfilled, (state, action) => {
        state.isUploading = false
        state.documents.push(action.payload)
      })
      .addCase(uploadKBDocument.rejected, (state, action) => {
        state.isUploading = false
        state.error = action.error.message || 'Failed to upload document'
      })
      .addCase(deleteKBDocument.fulfilled, (state, action) => {
        state.documents = state.documents.filter(d => d.doc_id !== action.payload)
      })
  },
})

export const { clearKBError } = kbSlice.actions
export default kbSlice.reducer
