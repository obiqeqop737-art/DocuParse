"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  FileText, Upload, MessageSquare, Send, Loader2, Search, BookOpen, 
  Sparkles, Layers, Menu, ChevronLeft, FileDown,
  AlertCircle, PlayCircle, Trash2, FileSpreadsheet, Presentation, Star, ShoppingBag,
  Target, Sun, Moon, BarChart3, Clock, Truck, Music, Mic, ChevronRight
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { 
  Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription 
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

import { performASR } from '@/ai/flows/asr-flow';

// 配置 PDF.js Worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

interface LocalDocument {
  id: string;
  name: string;
  type: string;
  status: 'pending_confirm' | 'processing' | 'completed' | 'error';
  content: string;
  createdAt: string;
  chatHistory: { role: 'user' | 'model'; content: string }[];
}

const SYSTEM_STRATEGIES = [
  {
    id: 'universal-expert',
    name: '全能文件解析专家',
    description: '通用型深度解析。强制输出[文件概览]与[文件脉络]大纲。',
    content: '你是一个全能文件解析专家。请对该文档进行深度研读，并严格按以下格式输出：\n\n1. [文件概览]：用三句话精准总结文档核心内容。\n2. [文件脉络]：以 Markdown 列表形式列出文档的主要章节 and 逻辑结构大纲。\n3. [详细解析]：根据文档内容对用户的提问进行专业解答。',
    authorName: '系统预设',
    starCount: 999
  },
  {
    id: 'logistics-expert',
    name: '物流文件解析助手',
    description: '专注于运单、装箱单、发票及提单。提取物流关键信息。',
    content: '你是一个资深的物流单证解析专家。请重点识别文档中的：运单号、发货人/收货人信息、物料描述、件数/毛重/体积、港口信息以及贸易条款。请按结构化表格输出关键物流参数。',
    authorName: '系统预设',
    starCount: 850
  },
  {
    id: 'speech-expert',
    name: '语音文件转译专家',
    description: '输出精准校准的原文本，并引导提问。',
    content: '你是一个语音文件转译专家。请根据输入的 ASR 内容，首先输出校准后的完整原文本，确保修正口语化冗余、语气词及同音错别字，使语意逻辑严密、标点准确。随后，请在回复的末尾增加一句引导语："以上是为您校准后的文本，您可以针对内容细节向我提问。"',
    authorName: '系统预设',
    starCount: 888
  },
  {
    id: 'factory-expert',
    name: '工厂文件解析专家',
    description: '专注于 SOP、BOM 表、设备规格及维保安全规程。',
    content: '你是一个精通工厂设备管理和生产流程的专家。请重点分析文档中的技术参数、物料清单(BOM)、操作标准程序(SOP)以及安全生产规范。',
    authorName: '系统预设',
    starCount: 777
  }
];

export default function DocuParsePro() {
  const { toast } = useToast();
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'marketplace'>('chat');
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string>('universal-expert');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isLoaded, setIsLoaded] = useState(false);
  
  const [localDocs, setLocalDocs] = useState<LocalDocument[]>([]);
  const uploadedFilesRef = useRef<Map<string, File>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  // 从 localStorage 加载数据
  useEffect(() => {
    try {
      const saved = localStorage.getItem('docuparse_docs');
      if (saved) {
        const parsed = JSON.parse(saved);
        // 只加载已解析的文档（包含内容的），排除待处理的
        const completedDocs = parsed.filter((d: LocalDocument) => d.status === 'completed' || d.status === 'error');
        setLocalDocs(completedDocs);
        if (completedDocs.length > 0) {
          toast({
            title: "已恢复会话",
            description: `找到 ${completedDocs.length} 个已解析的文档`,
          });
        }
      }
    } catch (e) {
      console.error('加载本地存储失败:', e);
    }
    setIsLoaded(true);
  }, []);

  // 保存到 localStorage（只保存已解析的文档）
  useEffect(() => {
    if (!isLoaded) return;
    try {
      // 过滤掉还在处理中的文档，只保存已完成的
      const toSave = localDocs.filter(d => d.status === 'completed' || d.status === 'error');
      localStorage.setItem('docuparse_docs', JSON.stringify(toSave));
    } catch (e) {
      console.error('保存本地存储失败:', e);
    }
  }, [localDocs, isLoaded]);

  // 直接使用系统预设策略，不需要 Firestore
  const allStrategies = useMemo(() => [...SYSTEM_STRATEGIES], []);
  const currentStrategy = useMemo(() => allStrategies.find(s => s.id === selectedRuleId) || SYSTEM_STRATEGIES[0], [allStrategies, selectedRuleId]);

  const selectedDoc = useMemo(() => localDocs.find(d => d.id === selectedDocId), [localDocs, selectedDocId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [selectedDoc?.chatHistory, isChatting, isExtracting]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const docId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
      
      const newDoc: LocalDocument = {
        id: docId,
        name: file.name,
        type: ext.toUpperCase(),
        status: 'pending_confirm',
        content: '',
        createdAt: new Date().toISOString(),
        chatHistory: []
      };

      uploadedFilesRef.current.set(docId, file);
      setLocalDocs(prev => [newDoc, ...prev]);
      setSelectedDocId(docId);
      setActiveTab('chat'); 
      
      toast({
        title: "文件就绪",
        description: `${file.name} 已准备好进行 AI 研读。`,
      });
    }
    e.target.value = '';
  };

  const startAnalysis = async (docId: string) => {
    const file = uploadedFilesRef.current.get(docId);
    if (!file) return;

    setIsExtracting(true);
    setLocalDocs(prev => prev.map(d => d.id === docId ? { ...d, status: 'processing' } : d));

    try {
      let finalContent = "";
      const ab = await file.arrayBuffer();
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      
      if (['wav', 'mp3', 'm4a', 'ogg'].includes(ext)) {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        const base64 = await base64Promise;
        const { text } = await performASR({ audioBase64: base64 });
        finalContent = text || "[音频转写未发现有效内容]";
      } 
      else if (ext === 'pdf') {
        const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
        const imagesToOCR: { pageIndex: number; dataUri: string }[] = [];
        
        // 300 DPI 高保真提取（工业场景需要高清）
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 3.0 }); 
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          
          await page.render({ canvasContext: context!, viewport }).promise;
          imagesToOCR.push({
            pageIndex: i,
            dataUri: canvas.toDataURL('image/jpeg', 0.8)
          });
        }
        
        const ocrResponse = await fetch('/api/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: imagesToOCR })
        });
        
        if (!ocrResponse.ok) {
          const errorData = await ocrResponse.json().catch(() => ({}));
          throw new Error(errorData.error || "OCR 识别失败");
        }
        
        const { results } = await ocrResponse.json();
        finalContent = results.map(r => `## 第 ${r.pageIndex} 页\n${r.text}`).join('\n\n');
        if (!finalContent.trim()) finalContent = "[PDF 视觉识别未提取到有效文本]";
      } 
      else if (ext === 'docx') {
        const res = await mammoth.extractRawText({ arrayBuffer: ab });
        finalContent = res.value.trim() || "[DOCX 内容提取为空]";
      } 
      else if (['xlsx', 'xls', 'csv'].includes(ext)) {
        const workbook = XLSX.read(ab);
        finalContent = workbook.SheetNames.map(name => XLSX.utils.sheet_to_txt(workbook.Sheets[name])).join('\n\n');
        if (!finalContent.trim()) finalContent = "[表格内容提取为空]";
      } 
      else {
        finalContent = (await file.text()).trim() || "[文本内容为空]";
      }

      const fullContent = `\n# 技术文档: ${file.name}\n\n${finalContent}\n`;
      setLocalDocs(prev => prev.map(d => d.id === docId ? { ...d, content: fullContent, status: 'completed' } : d));
      
      setIsExtracting(false);
      setIsChatting(true);

      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          documentContent: fullContent, 
          userQuery: `请执行[${currentStrategy.name}]指令，开始深度解析。`, 
          rules: currentStrategy.content, 
          history: [] 
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "AI 引擎连接失败");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = "";
      let leftover = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const combined = leftover + decoder.decode(value, { stream: true });
        const lines = combined.split('\n');
        leftover = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim().startsWith('data: ')) continue;
          const dataStr = line.trim().slice(6);
          if (dataStr === '[DONE]') break;
          try {
            const delta = JSON.parse(dataStr).choices[0]?.delta?.content || "";
            if (delta) {
              fullAnswer += delta;
              setLocalDocs(prev => prev.map(d => d.id === docId ? { 
                ...d, 
                chatHistory: [{ role: 'model', content: fullAnswer }]
              } : d));
            }
          } catch (e) {}
        }
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "解析中断", description: err.message });
      setLocalDocs(prev => prev.map(d => d.id === docId ? { ...d, status: 'error' } : d));
    } finally {
      setIsExtracting(false);
      setIsChatting(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !selectedDoc || isChatting) return;
    const history = [...(selectedDoc.chatHistory || []), { role: 'user', content: chatInput } as const];
    const userQuery = chatInput;
    setLocalDocs(prev => prev.map(d => d.id === selectedDoc.id ? { ...d, chatHistory: history } : d));
    setChatInput('');
    setIsChatting(true);

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          documentContent: selectedDoc.content, 
          userQuery, 
          rules: currentStrategy.content, 
          history: selectedDoc.chatHistory 
        })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "API 响应异常");
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = "";
      let leftover = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const combined = leftover + decoder.decode(value, { stream: true });
        const lines = combined.split('\n');
        leftover = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim().startsWith('data: ')) continue;
          const dataStr = line.trim().slice(6);
          if (dataStr === '[DONE]') break;
          try {
            const delta = JSON.parse(dataStr).choices[0]?.delta?.content || "";
            if (delta) {
              fullAnswer += delta;
              setLocalDocs(prev => prev.map(d => d.id === selectedDoc.id ? { 
                ...d, 
                chatHistory: [...history, { role: 'model', content: fullAnswer }] 
              } : d));
            }
          } catch (e) {}
        }
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "发送失败", description: err.message });
    } finally { setIsChatting(false); }
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-white/70 dark:bg-slate-900/70 backdrop-blur-2xl rounded-r-3xl overflow-hidden border-r border-white/20 shadow-xl">
      <div className="p-6 border-b border-white/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
            <BookOpen size={20} />
          </div>
          <div>
            <h1 className="font-semibold text-slate-900 dark:text-white">DocuParse</h1>
            <p className="text-xs text-blue-500 font-medium">智能文档解析</p>
          </div>
        </div>
      </div>
      
      <nav className="flex-1 p-4 overflow-y-auto">
        <div className="space-y-1">
          <button onClick={() => setActiveTab('chat')} className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-sm font-medium", activeTab === 'chat' ? "bg-gradient-to-r from-blue-500 to-cyan-400 text-white shadow-lg shadow-blue-500/25" : "text-slate-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-white/10")}>
            <MessageSquare size={18} /> 智能解析
          </button>
          <button onClick={() => setActiveTab('marketplace')} className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-sm font-medium", activeTab === 'marketplace' ? "bg-gradient-to-r from-blue-500 to-cyan-400 text-white shadow-lg shadow-blue-500/25" : "text-slate-600 dark:text-slate-300 hover:bg-white/50 dark:hover:bg-white/10")}>
            <ShoppingBag size={18} /> 解析规则
          </button>
        </div>

        <div className="mt-8">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3 px-4">我的文档</p>
          <div className="space-y-1">
            {localDocs.map(d => (
              <div key={d.id} className="group flex items-center gap-2">
                <button 
                  onClick={() => setSelectedDocId(d.id)} 
                  className={cn(
                    "flex-1 flex items-center gap-3 px-4 py-2.5 rounded-2xl transition-all text-left", 
                    selectedDocId === d.id 
                      ? "bg-white/80 dark:bg-white/10 shadow-lg" 
                      : "hover:bg-white/50 dark:hover:bg-white/10"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-xl flex items-center justify-center shrink-0", 
                    selectedDocId === d.id ? "bg-gradient-to-br from-blue-500 to-cyan-400 text-white" : "bg-blue-100 dark:bg-blue-900/30 text-blue-500"
                  )}>
                    {['MP3','WAV','M4A','OGG'].includes(d.type) ? <Music size={14} /> : <FileText size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{d.name}</p>
                  </div>
                </button>
                <button 
                  onClick={() => {
                    if (confirm(`确定要删除 "${d.name}" 吗？`)) {
                      const newDocs = localDocs.filter(doc => doc.id !== d.id);
                      setLocalDocs(newDocs);
                      localStorage.setItem('docuparse_docs', JSON.stringify(newDocs));
                      if (selectedDocId === d.id) {
                        setSelectedDocId(null);
                      }
                      toast({ title: "已删除", description: d.name });
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-xl transition-all"
                >
                  <Trash2 size={14} className="text-red-500" />
                </button>
              </div>
            ))}
            {localDocs.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8">暂无文档</p>
            )}
          </div>
        </div>
      </nav>

      <div className="p-4 border-t border-white/20">
        <label className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-cyan-400 text-white py-3 rounded-2xl transition-all text-sm font-medium shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 cursor-pointer">
          <Upload size={16} /> 上传文件
          <input type="file" multiple className="hidden" onChange={handleFileUpload} accept=".txt,.pdf,.docx,.doc,.xlsx,.xls,.csv,.mp3,.wav,.m4a,.ogg" />
        </label>
      </div>
    </div>
  );

  return (
    <div className={cn("flex h-screen relative overflow-hidden", theme === 'dark' ? "bg-slate-950" : "bg-gradient-to-br from-blue-50 via-white to-cyan-50")}>
      <aside className={cn("hidden lg:block transition-all duration-300 shrink-0 z-40 p-2", isSidebarOpen ? "w-[300px]" : "w-0")}>
        <SidebarContent />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 relative">
        <header className="h-16 px-6 flex items-center justify-between border-b border-white/20 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md sticky top-0 shrink-0 z-30">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
              <Menu size={20} />
            </Button>
            <div className="flex flex-col">
              <h2 className="font-semibold text-slate-900 dark:text-white">{activeTab === 'chat' ? '智能解析' : '解析规则'}</h2>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-xs text-slate-500">当前策略: {currentStrategy.name}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 rounded-full font-medium">
              DeepSeek V3.2
            </span>
          </div>
        </header>

        {activeTab === 'chat' && (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
            <div className={cn("flex-1 flex flex-col relative bg-white/10", !selectedDocId && "hidden lg:flex")}>
              {selectedDocId && !selectedDoc ? (
                <div className="flex-1 flex flex-col items-center justify-center animate-pulse">
                  <Loader2 className="animate-spin text-primary mb-4" size={40} />
                  <p className="font-black uppercase tracking-widest text-sm opacity-40">引擎准备中...</p>
                </div>
              ) : selectedDoc ? (
                <>
                  <div className="lg:hidden p-4 border-b border-black/5 flex items-center bg-white/80">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedDocId(null)} className="font-black opacity-60"><ChevronLeft size={18} /> 返回</Button>
                    <p className="ml-4 font-black text-sm truncate">{selectedDoc.name}</p>
                  </div>
                  {selectedDoc.status === 'pending_confirm' || selectedDoc.status === 'processing' ? (
                    <div className="flex-1 flex items-center justify-start p-10 lg:p-20">
                      <Card className="max-w-md w-full rounded-[3.5rem] shadow-2xl p-10 text-center border-none bg-white dark:bg-slate-900 shadow-primary/5">
                        <div className="w-20 h-20 bg-primary/10 text-primary rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-inner">
                          {selectedDoc.status === 'processing' ? <Loader2 className="animate-spin" size={40} /> : <AlertCircle size={40} />}
                        </div>
                        <CardTitle className="text-2xl font-black mb-4">{selectedDoc.status === 'processing' ? '正在视觉研读...' : '文件就绪'}</CardTitle>
                        <CardDescription className="font-bold opacity-60 mb-8 uppercase tracking-widest text-xs">
                          {selectedDoc.status === 'processing' ? '正在执行 OCR 视觉提取与 ASR 转译' : `准备解析: ${selectedDoc.name}`}
                        </CardDescription>
                        {selectedDoc.status === 'pending_confirm' && (
                          <Button onClick={() => startAnalysis(selectedDoc.id)} disabled={isExtracting} className="w-full h-16 rounded-[1.8rem] bg-primary text-lg font-black shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all">
                            {isExtracting ? <Loader2 className="animate-spin mr-2" /> : <PlayCircle size={24} className="mr-2" />}
                            开启深度解析
                          </Button>
                        )}
                      </Card>
                    </div>
                  ) : (
                    <>
                      <ScrollArea className="flex-1 px-8 lg:px-12 py-12" ref={scrollRef}>
                        <div className="max-w-3xl space-y-12 pb-32">
                          <div className="bg-primary/5 border border-primary/10 p-6 rounded-[2rem] flex items-start gap-4 mb-8">
                             <div className="w-10 h-10 rounded-xl bg-primary/20 text-primary flex items-center justify-center shrink-0"><Target size={20} /></div>
                             <div>
                               <p className="text-[10px] font-black uppercase text-primary tracking-widest mb-1">已挂载规则专家</p>
                               <h4 className="font-black text-sm">{currentStrategy.name}</h4>
                               <p className="text-[11px] opacity-60 font-bold mt-1">{currentStrategy.description}</p>
                             </div>
                          </div>
                          {selectedDoc.chatHistory?.map((m, i) => (
                            <div key={i} className={cn("flex gap-5", m.role === 'user' ? "flex-row-reverse text-right" : "flex-row text-left")}>
                              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-black/5 font-black text-[12px] shadow-sm", m.role === 'user' ? "bg-black/5" : "bg-primary text-white")}>{m.role === 'user' ? 'ME' : <Sparkles size={18} />}</div>
                              <div className={cn("max-w-[85%] p-6 rounded-[2rem] text-sm lg:text-[15px] font-bold leading-relaxed shadow-sm", m.role === 'user' ? "bg-primary text-white rounded-tr-none" : "bg-white dark:bg-slate-800/80 border border-black/5 rounded-tl-none prose prose-slate dark:prose-invert")}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                              </div>
                            </div>
                          ))}
                          {(isChatting || isExtracting) && (
                            <div className="flex gap-5">
                              <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-md animate-pulse"><Loader2 className="animate-spin" size={18} /></div>
                              <div className="bg-white/80 dark:bg-slate-800/80 p-6 rounded-[2rem] rounded-tl-none border border-black/5 animate-pulse text-sm font-bold opacity-40 shadow-sm">
                                {isExtracting ? "正在进行 300DPI 视觉扫描..." : "DeepSeek 正在思考文档脉络..."}
                              </div>
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                      <footer className="p-8 lg:p-10 border-t border-black/5 bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl sticky bottom-0">
                        <div className="max-w-3xl relative mx-auto lg:mx-0">
                          <textarea 
                            placeholder={`基于 [${currentStrategy.name}] 的解析结果追问...`} 
                            className="w-full min-h-[90px] bg-white dark:bg-slate-800 border border-black/10 rounded-[2rem] p-6 pr-20 text-sm lg:text-[15px] font-bold focus:ring-4 focus:ring-primary/10 shadow-xl resize-none transition-all" 
                            value={chatInput} 
                            onChange={(e) => setChatInput(e.target.value)} 
                          />
                          <div className="absolute right-4 bottom-4">
                             <Button onClick={handleSendMessage} disabled={!chatInput.trim() || isChatting} className="w-14 h-14 rounded-2xl bg-primary shadow-xl shadow-primary/20 hover:shadow-primary/40 transition-all"><Send size={22} /></Button>
                          </div>
                        </div>
                      </footer>
                    </>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center opacity-10">
                  <MessageSquare size={120} />
                  <h3 className="text-3xl font-black mt-8 uppercase tracking-[1em]">解析终端就绪</h3>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'marketplace' && (
          <ScrollArea className="flex-1 bg-slate-50 dark:bg-slate-950">
            <div className="max-w-[1400px] mx-auto p-12 pb-40">
              <div className="mb-20 text-center">
                <p className="opacity-30 font-black uppercase tracking-[0.6em] text-xs">Global Extraction Strategy</p>
                <h3 className="text-4xl font-black mt-4 tracking-tighter">策略解析规则广场</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12 p-12">
                {allStrategies.map(s => (
                  <Card key={s.id} className={cn("rounded-[3.5rem] border-none shadow-2xl bg-white dark:bg-slate-900 transition-all hover:-translate-y-2 flex flex-col h-full overflow-hidden p-1 shadow-black/5 relative", selectedRuleId === s.id && "ring-[10px] ring-primary shadow-primary/30")}>
                    <CardHeader className="p-8 pb-4 relative">
                      <div className="flex justify-between items-start mb-6">
                        <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg", s.id.includes('universal') ? "bg-blue-600" : s.id.includes('speech') ? "bg-amber-500" : s.id.includes('logistics') ? "bg-emerald-600" : "bg-slate-800")}>
                          {s.id.includes('speech') ? <Mic size={24} /> : s.id.includes('logistics') ? <Truck size={24} /> : <Sparkles size={24} />}
                        </div>
                        <div className="flex items-center gap-1 opacity-20 text-[11px] font-black"><Star size={12} fill="currentColor" /> {s.starCount}</div>
                      </div>
                      <CardTitle className="text-xl font-black mb-1 text-slate-900 dark:text-white leading-tight">{s.name}</CardTitle>
                      <CardDescription className="text-xs font-bold opacity-40 dark:opacity-60 leading-relaxed uppercase tracking-tight line-clamp-1">{s.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="px-8 pb-4 flex-1">
                       <div className="bg-slate-50 dark:bg-slate-800/50 p-5 rounded-2xl text-[11px] font-bold opacity-60 dark:opacity-80 h-28 overflow-hidden italic border border-black/5">
                         {s.content}
                       </div>
                    </CardContent>
                    <CardFooter className="p-8 pt-0 flex flex-col gap-4">
                      <div className="flex justify-between items-center w-full px-1">
                        <span className="text-[10px] font-black opacity-30 uppercase tracking-widest">{s.authorName}</span>
                      </div>
                      <Button onClick={() => setSelectedRuleId(s.id)} className={cn("w-full h-14 rounded-2xl font-black text-sm uppercase tracking-widest transition-all", selectedRuleId === s.id ? "bg-primary text-white shadow-lg shadow-primary/20" : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200")}>
                        {selectedRuleId === s.id ? '当前挂载' : '载入引擎'}
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </div>
          </ScrollArea>
        )}
      </main>

      <style jsx global>{`
        .prose p { @apply text-sm lg:text-[15px] mb-4 opacity-70 font-bold leading-relaxed; }
        .prose h1, .prose h2 { @apply font-black mt-8 mb-4 tracking-tight uppercase; }
        .prose table { @apply w-full border-collapse rounded-xl overflow-hidden my-6 bg-slate-50/50; }
        .prose th { @apply bg-slate-100 p-4 text-[10px] font-black uppercase text-left border-b border-slate-200; }
        .prose td { @apply p-4 border-t border-slate-100 text-[13px] font-bold opacity-70; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
