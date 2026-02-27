"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  FileText, Upload, Settings, MessageSquare, Send, Loader2, Search, BookOpen, 
  Sparkles, ShieldCheck, Truck, Layers, Menu, ChevronLeft, FileDown, Eye, 
  CheckCircle2, FileSearch, Database, Activity, Clock, BarChart3, PieChart as PieChartIcon,
  RefreshCw, AlertCircle, PlayCircle, Trash2, FileSpreadsheet, Presentation
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { performOCR } from '@/ai/flows/ocr-flow';
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

import { 
  useUser, 
  useFirestore, 
  useCollection, 
  useMemoFirebase,
  initiateAnonymousSignIn,
  addDocumentNonBlocking
} from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, 
  ResponsiveContainer, Cell, PieChart, Pie
} from 'recharts';

// 配置 Server Action 超时时间为 120 秒
export const maxDuration = 120;

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

interface Message {
  role: 'user' | 'model';
  content: string;
}

interface Rule {
  id: string;
  name: string;
  icon: React.ReactNode;
  content: string;
}

interface Document {
  id: string;
  name: string;
  type: string;
  status: 'pending_confirm' | 'processing' | 'ocr_scanning' | 'completed' | 'error';
  content: string;
  date: string;
  chatHistory: Message[];
}

const DEFAULT_RULES: Rule[] = [
  { 
    id: '1', 
    name: '全能架构解析', 
    icon: <Layers size={14} />,
    content: '作为技术文档专家，请系统性地解析该文件。首先，请精准识别并按顺序例举出文档的所有章节目录。其次，提取全文各个章节的核心技术信息、管理要求或物流标准。最后，针对每个章节给出精炼的摘要分析。' 
  },
  { 
    id: '2', 
    name: '供应商合规审查', 
    icon: <ShieldCheck size={14} />,
    content: '重点核查文档中涉及供应商准入、质量控制、EHS合规性以及违规处罚的相关条款。请对比工厂标准，列出所有不符项或高风险点。' 
  },
  { 
    id: '3', 
    name: '物流装卸标准', 
    icon: <Truck size={14} />,
    content: '专注于提取物流作业标准、交货周期、装卸规范、托盘/包装要求以及运输保险相关条款。' 
  }
];

const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];

export default function DocuParsePro() {
  const { toast } = useToast();
  const { user, auth } = useUser();
  const db = useFirestore();
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'rules' | 'stats'>('chat');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [isTestingApi, setIsTestingApi] = useState(false);
  
  // 用于存储上传的 File 对象，确保解析时能正确获取
  const uploadedFilesRef = useRef<Map<string, File>>(new Map());
  
  const [rules, setRules] = useState<Rule[]>(DEFAULT_RULES);
  const [selectedRuleId, setSelectedRuleId] = useState<string>(DEFAULT_RULES[0].id);

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRule = rules.find(r => r.id === selectedRuleId) || rules[0];
  const selectedDoc = documents.find(d => d.id === selectedDocId);

  const isCurrentlyReading = useMemo(() => {
    if (!isChatting || !selectedDoc) return false;
    const history = selectedDoc.chatHistory;
    if (history.length === 0) return true;
    const lastMsg = history[history.length - 1];
    // 如果最后一条消息是 model 且内容为空，说明正在研读中
    return lastMsg.role === 'model' && lastMsg.content === '';
  }, [isChatting, selectedDoc]);

  useEffect(() => {
    if (!user && auth) initiateAnonymousSignIn(auth);
  }, [user, auth]);

  const logsQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'users', user.uid, 'trafficConsumptionLogs'), orderBy('eventDateTime', 'desc'), limit(50));
  }, [db, user?.uid]);

  const { data: logs, isLoading: isLogsLoading } = useCollection(logsQuery);

  const recordUsage = (type: string, amount: number, unit: string, details: any) => {
    if (!db || !user?.uid) return;
    addDocumentNonBlocking(collection(db, 'users', user.uid, 'trafficConsumptionLogs'), {
      userId: user.uid,
      eventType: type === 'Chat' ? 'AIProcessing' : 'DocumentProcessed',
      eventDateTime: new Date().toISOString(),
      consumedAmount: amount,
      consumptionUnit: unit,
      details: JSON.stringify(details)
    });
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [selectedDoc?.chatHistory, isChatting]);

  const processPDF = async (file: File, fileId: string): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pagesData: string[] = new Array(pdf.numPages).fill("");
    const imagesToOCR: { pageIndex: number; dataUri: string }[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      let pageText = (textContent.items as any[]).map(item => item.str).join(' ').trim();
      
      if (pageText.length < 50) {
        const canvas = document.createElement('canvas');
        const viewport = page.getViewport({ scale: 1.5 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          await page.render({ canvasContext: ctx, viewport }).promise;
          imagesToOCR.push({ pageIndex: i - 1, dataUri: canvas.toDataURL('image/jpeg', 0.85) });
        }
      } else {
        pagesData[i - 1] = pageText;
      }
    }

    if (imagesToOCR.length > 0) {
      setDocuments(prev => prev.map(d => d.id === fileId ? { ...d, status: 'ocr_scanning' } : d));
      const ocrRes = await performOCR({ images: imagesToOCR });
      ocrRes.results.forEach(res => { pagesData[res.pageIndex] = res.text; });
      recordUsage('OCR', imagesToOCR.length, 'pages', { filename: file.name });
    }
    return pagesData.map((t, idx) => `### 第 ${idx + 1} 页 ###\n\n${t}`).join('\n\n');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const fileId = Math.random().toString(36).substring(2, 9);
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const newDoc: Document = {
        id: fileId,
        name: file.name,
        type: ext.toUpperCase(),
        status: 'pending_confirm',
        content: '',
        date: new Date().toLocaleDateString(),
        chatHistory: []
      };
      
      // 存储文件对象
      uploadedFilesRef.current.set(fileId, file);
      
      setDocuments(prev => [newDoc, ...prev]);
      setSelectedDocId(fileId);
    }
    // 重置 input
    e.target.value = '';
  };

  const startAnalysis = async (docId: string) => {
    const doc = documents.find(d => d.id === docId);
    if (!doc) return;

    const file = uploadedFilesRef.current.get(docId);
    if (!file) {
      toast({ variant: "destructive", title: "文件读取失败", description: "请尝试重新上传文件。" });
      return;
    }

    setDocuments(prev => prev.map(d => d.id === docId ? { ...d, status: 'processing' } : d));
    
    try {
      let finalContent = "";
      if (doc.type === 'PDF') {
        finalContent = await processPDF(file, docId);
      } else if (['DOCX', 'XLSX', 'XLS', 'CSV', 'PPTX', 'PPT'].includes(doc.type)) {
        const ab = await file.arrayBuffer();
        if (doc.type === 'DOCX') {
          const result = await mammoth.extractRawText({ arrayBuffer: ab });
          finalContent = result.value;
        } else if (['XLSX', 'XLS', 'CSV'].includes(doc.type)) {
          const wb = XLSX.read(ab, { type: 'array' });
          wb.SheetNames.forEach(name => {
            const ws = wb.Sheets[name];
            const json = XLSX.utils.sheet_to_json(ws, { header: 1 });
            finalContent += `\n### 工作表: ${name} ###\n\n${json.map((r: any) => `| ${Array.isArray(r) ? r.join(' | ') : r} |`).join('\n')}\n`;
          });
        } else {
          finalContent = `[该格式 (${doc.type}) 暂不支持深度内容提取，已解析文件名: ${doc.name}]`;
        }
      } else {
        finalContent = await file.text();
      }

      if (!finalContent.trim()) {
        throw new Error("未能从文档中提取到有效文本内容。");
      }

      const fullContent = `\n# 文档内容: ${doc.name}\n\n${finalContent}\n`;
      setDocuments(prev => prev.map(d => d.id === docId ? { ...d, content: fullContent, status: 'completed' } : d));
      
      setIsChatting(true);
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          documentContent: fullContent, 
          userQuery: `请执行[${activeRule.name}]：根据预设策略对文档进行初步分析。`, 
          rules: activeRule.content, 
          history: [] 
        })
      });

      if (!response.ok) throw new Error('AI 响应初始化失败');
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = "";

      setDocuments(prev => prev.map(d => d.id === docId ? { ...d, chatHistory: [{ role: 'model', content: '' }] } : d));

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') break;
            try {
              const data = JSON.parse(dataStr);
              const text = data.choices[0]?.delta?.content || "";
              fullAnswer += text;
              setDocuments(prev => prev.map(d => d.id === docId ? { ...d, chatHistory: [{ role: 'model', content: fullAnswer }] } : d));
            } catch (e) {}
          }
        }
      }
      recordUsage('Chat', 1, 'API_call', { docId, mode: 'Auto', type: doc.type });
    } catch (err: any) {
      toast({ variant: "destructive", title: "解析失败", description: err.message });
      setDocuments(prev => prev.map(d => d.id === docId ? { ...d, status: 'error' } : d));
    } finally {
      setIsChatting(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !selectedDoc || isChatting) return;
    const userMsg: Message = { role: 'user', content: chatInput };
    const currentHistory = [...selectedDoc.chatHistory, userMsg];
    setDocuments(prev => prev.map(d => d.id === selectedDoc.id ? { ...d, chatHistory: currentHistory } : d));
    setChatInput('');
    setIsChatting(true);

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          documentContent: selectedDoc.content, 
          userQuery: userMsg.content, 
          rules: activeRule.content, 
          history: selectedDoc.chatHistory 
        })
      });
      if (!res.ok) throw new Error('发送失败');
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = "";
      setDocuments(prev => prev.map(d => d.id === selectedDoc.id ? { ...d, chatHistory: [...currentHistory, { role: 'model', content: '' }] } : d));

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') break;
            try {
              const data = JSON.parse(dataStr);
              const text = data.choices[0]?.delta?.content || "";
              fullAnswer += text;
              setDocuments(prev => prev.map(d => d.id === selectedDoc.id ? { ...d, chatHistory: [...currentHistory, { role: 'model', content: fullAnswer }] } : d));
            } catch (e) {}
          }
        }
      }
      recordUsage('Chat', 1, 'API_call', { docId: selectedDoc.id, mode: 'Manual' });
    } catch (err: any) {
      toast({ variant: "destructive", title: "发送失败", description: err.message });
    } finally {
      setIsChatting(false);
    }
  };

  const chartData = useMemo(() => {
    if (!logs) return [];
    const dailyMap = new Map();
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      dailyMap.set(d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }), 0);
    }
    logs.forEach(l => {
      const k = new Date(l.eventDateTime).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
      if (dailyMap.has(k)) dailyMap.set(k, dailyMap.get(k) + (l.consumedAmount || 0));
    });
    return Array.from(dailyMap.entries()).map(([date, amount]) => ({ date, amount }));
  }, [logs]);

  const pieData = useMemo(() => {
    if (!logs) return [];
    const m = new Map([['语义解析', 0], ['视觉识别', 0], ['其他', 0]]);
    logs.forEach(l => {
      const label = l.eventType === 'AIProcessing' ? '语义解析' : l.eventType === 'DocumentProcessed' ? '视觉识别' : '其他';
      m.set(label, (m.get(label) || 0) + (l.consumedAmount || 0));
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [logs]);

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'PDF': return <FileDown size={14} />;
      case 'DOCX':
      case 'DOC': return <FileText size={14} />;
      case 'XLSX':
      case 'XLS':
      case 'CSV': return <FileSpreadsheet size={14} />;
      case 'PPTX':
      case 'PPT': return <Presentation size={14} />;
      default: return <FileText size={14} />;
    }
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-white/70 backdrop-blur-xl border-r border-white/20">
      <div className="p-4 flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/30 text-white shrink-0">
          <BookOpen size={16} />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-black text-slate-800 tracking-tight truncate">DocuParse</h1>
          <p className="text-[8px] font-bold text-blue-600/60 uppercase tracking-widest truncate">AI 助理</p>
        </div>
      </div>
      
      <nav className="flex-1 px-2 space-y-1 overflow-hidden">
        <button onClick={() => setActiveTab('chat')} className={cn("w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all font-bold text-[11px]", activeTab === 'chat' ? "bg-blue-600 text-white shadow-md shadow-blue-600/20" : "text-slate-500 hover:bg-white hover:text-blue-600")}>
          <MessageSquare size={14} /> 智能对话
        </button>
        <button onClick={() => setActiveTab('rules')} className={cn("w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all font-bold text-[11px]", activeTab === 'rules' ? "bg-blue-600 text-white shadow-md shadow-blue-600/20" : "text-slate-500 hover:bg-white hover:text-blue-600")}>
          <Settings size={14} /> 策略库
        </button>
        <button onClick={() => setActiveTab('stats')} className={cn("w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all font-bold text-[11px]", activeTab === 'stats' ? "bg-blue-600 text-white shadow-md shadow-blue-600/20" : "text-slate-500 hover:bg-white hover:text-blue-600")}>
          <BarChart3 size={14} /> 统计后台
        </button>

        <div className="mt-6 mb-2 px-3"><p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">解析策略</p></div>
        {rules.map(r => (
          <button key={r.id} onClick={() => setSelectedRuleId(r.id)} className={cn("w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-all text-[10px] font-bold text-left min-w-0", selectedRuleId === r.id ? "bg-blue-50 text-blue-600 ring-1 ring-blue-100" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600")}>
            <span className="shrink-0">{r.icon}</span>
            <span className="truncate">{r.name}</span>
          </button>
        ))}
      </nav>

      <div className="p-3 border-t border-white/20 bg-blue-50/30">
        <label className="group relative w-full flex items-center justify-center gap-2 bg-white hover:bg-blue-600 hover:text-white p-2.5 rounded-lg border border-blue-100 transition-all shadow-md shadow-blue-600/5 cursor-pointer active:scale-95">
          <Upload size={14} className="transition-transform group-hover:-translate-y-0.5" />
          <span className="text-[10px] font-black">上传文档</span>
          <input type="file" multiple className="hidden" onChange={handleFileUpload} accept=".txt,.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.csv" />
        </label>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#f8fafc] overflow-hidden">
      <aside className={cn("hidden lg:block transition-all duration-300 shrink-0 border-r border-white/20", isSidebarOpen ? "w-[300px]" : "w-0 overflow-hidden")}>
        <SidebarContent />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 relative">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-400/10 blur-[120px] rounded-full -translate-y-1/2 translate-x-1/2 -z-10" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-purple-400/5 blur-[100px] rounded-full translate-y-1/2 -translate-x-1/2 -z-10" />

        <header className="h-14 px-4 flex items-center justify-between bg-white/40 backdrop-blur-md border-b border-white/20 sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden"><Menu size={18} /></Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-[300px]">
                <SheetHeader className="sr-only">
                  <SheetTitle>导航菜单</SheetTitle>
                  <SheetDescription>查看文档列表和设置</SheetDescription>
                </SheetHeader>
                <SidebarContent />
              </SheetContent>
            </Sheet>
            <Button variant="ghost" size="icon" className="hidden lg:flex text-slate-400" onClick={() => setIsSidebarOpen(!isSidebarOpen)}><ChevronLeft className={cn("transition-transform", !isSidebarOpen && "rotate-180")} size={16} /></Button>
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <h2 className="font-black text-slate-800 text-sm hidden sm:block truncate shrink-0">
                {activeTab === 'chat' ? '控制台' : activeTab === 'rules' ? '策略库' : '统计'}
              </h2>
              {selectedDoc && activeTab === 'chat' && (
                <Badge variant="outline" className="bg-white/80 border-blue-100 text-blue-600 rounded-lg px-2 py-0.5 flex items-center gap-1.5 max-w-[160px] shadow-sm overflow-hidden min-w-0">
                  {getFileIcon(selectedDoc.type)}
                  <span className="truncate flex-1 text-[9px] font-bold ml-1">{selectedDoc.name}</span>
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1.5 px-2 py-1 bg-white/60 rounded-lg border border-white/20 shadow-sm">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-lg shadow-green-500/50 animate-pulse" />
              <span className="text-[9px] font-black text-slate-600">DEEPSEEK V3</span>
            </div>
          </div>
        </header>

        {activeTab === 'chat' && (
          <div className="flex-1 flex overflow-hidden">
            <div className={cn("w-[300px] border-r border-white/20 bg-white/10 flex flex-col shrink-0 transition-all", selectedDocId && "hidden lg:flex")}>
              <div className="p-4 shrink-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
                  <Input placeholder="检索文档..." className="pl-8 h-8 bg-white/80 border-none rounded-lg shadow-sm text-[10px] focus-visible:ring-blue-200" />
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="pb-8 space-y-2 flex flex-col items-center min-w-0 overflow-hidden">
                  {documents.length === 0 ? (
                    <div className="py-20 text-center opacity-20"><FileSearch size={32} className="mx-auto mb-2" /><p className="text-[9px] font-black uppercase tracking-widest">等待解析</p></div>
                  ) : (
                    documents.map(d => (
                      <button key={d.id} onClick={() => setSelectedDocId(d.id)} className={cn("w-[calc(100%-32px)] mx-auto p-2.5 rounded-xl border transition-all text-left flex items-start gap-2.5 group relative overflow-hidden min-w-0", selectedDocId === d.id ? "bg-white border-blue-600 shadow-lg shadow-blue-600/5" : "bg-transparent border-transparent hover:bg-white/40")}>
                        <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0 shadow-sm", selectedDocId === d.id ? "bg-blue-600 text-white" : "bg-white text-slate-400")}>
                          {getFileIcon(d.type)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-black text-[10px] text-slate-800 truncate block max-w-[140px] pr-1">{d.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[8px] font-bold text-slate-400">{d.date}</span>
                            {d.status === 'completed' ? <Badge className="bg-green-50 text-green-600 text-[7px] h-3.5 px-1 font-bold">已解析</Badge> : d.status === 'pending_confirm' ? <Badge className="bg-orange-50 text-orange-600 text-[7px] h-3.5 px-1 font-bold">待确认</Badge> : <Badge className="bg-blue-50 text-blue-600 text-[7px] h-3.5 px-1 font-bold animate-pulse">解析中</Badge>}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className={cn("flex-1 flex flex-col bg-white/30 relative", !selectedDocId && "hidden lg:flex")}>
              {selectedDoc ? (
                <>
                  {selectedDoc.status === 'pending_confirm' ? (
                    <div className="flex-1 flex items-center justify-center p-6">
                      <Card className="max-w-xs w-full rounded-[1.5rem] border-none shadow-2xl bg-white p-6 text-center animate-in zoom-in-95">
                        <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-inner"><AlertCircle size={24} /></div>
                        <CardTitle className="text-lg font-black mb-2">解析确认</CardTitle>
                        <CardDescription className="text-[10px] font-bold text-slate-500 mb-6 leading-relaxed">系统已准备好处理 <span className="text-blue-600 truncate inline-block max-w-[120px] align-bottom">"{selectedDoc.name}"</span>。</CardDescription>
                        <div className="flex flex-col gap-2">
                          <Button onClick={() => startAnalysis(selectedDoc.id)} className="w-full h-10 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-black text-xs shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2">
                            <PlayCircle size={14} /> 开启 AI 深度解析
                          </Button>
                          <Button variant="ghost" onClick={() => {
                            uploadedFilesRef.current.delete(selectedDoc.id);
                            setDocuments(prev => prev.filter(d => d.id !== selectedDoc.id));
                          }} className="text-slate-400 text-[10px] font-bold hover:text-red-500 h-8"><Trash2 size={12} className="mr-1.5" /> 取消</Button>
                        </div>
                      </Card>
                    </div>
                  ) : (
                    <>
                      <ScrollArea className="flex-1 px-4 md:px-8 py-6" ref={scrollRef}>
                        <div className="max-w-3xl mx-auto space-y-6 pb-20">
                          {selectedDoc.chatHistory.map((m, i) => (
                            <div key={i} className={cn("flex gap-3", m.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border shadow-sm font-black text-[8px]", m.role === 'user' ? "bg-white text-slate-400" : "bg-blue-600 text-white shadow-blue-600/20")}>
                                {m.role === 'user' ? 'ME' : <Sparkles size={14} />}
                              </div>
                              <div className={cn("max-w-[85%] p-4 rounded-[1.25rem] text-[11px] leading-relaxed shadow-sm transition-all overflow-hidden", m.role === 'user' ? "bg-blue-600 text-white rounded-tr-none" : "bg-white/80 backdrop-blur-sm border rounded-tl-none prose prose-slate prose-invert-0")}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                              </div>
                            </div>
                          ))}
                          {isCurrentlyReading && (
                            <div className="flex gap-3">
                              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-lg shadow-blue-600/20"><Sparkles size={14} /></div>
                              <div className="bg-white/60 backdrop-blur-sm border p-4 rounded-[1.25rem] rounded-tl-none flex items-center gap-2.5 shadow-sm">
                                <Loader2 className="animate-spin text-blue-600" size={14} />
                                <span className="text-[10px] font-black text-slate-700">正在研读脉络...</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                      <footer className="p-4 border-t border-white/20 bg-white/40 backdrop-blur-xl shrink-0">
                        <div className="max-w-3xl mx-auto relative group">
                          <textarea placeholder="进一步提问..." className="w-full min-h-[44px] max-h-[120px] bg-white/80 border-none rounded-[1.25rem] p-3 pr-14 text-[11px] font-bold focus:ring-2 focus:ring-blue-100 shadow-inner resize-none no-scrollbar" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} />
                          <Button onClick={handleSendMessage} disabled={!chatInput.trim() || isChatting || selectedDoc.status !== 'completed'} className="absolute right-2 bottom-2 w-8 h-8 rounded-lg bg-blue-600 text-white shadow-lg shadow-blue-600/30 hover:scale-105 active:scale-95 transition-all">
                            <Send size={14} />
                          </Button>
                        </div>
                      </footer>
                    </>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
                  <div className="w-20 h-20 bg-white/80 rounded-[1.5rem] shadow-2xl flex items-center justify-center mb-6 border border-white/20"><MessageSquare size={32} className="text-blue-600/20" /></div>
                  <h3 className="text-xl font-black text-slate-800 tracking-tight">上传技术文档</h3>
                  <p className="mt-2 text-slate-400 font-bold text-[10px] max-w-xs leading-relaxed uppercase tracking-widest">AI 精准提取核心技术要点</p>
                  <Button variant="outline" className="mt-8 h-12 rounded-lg px-8 border-2 border-blue-100 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all font-black text-xs group" asChild>
                    <label className="cursor-pointer">
                      <Upload size={14} className="mr-2 transition-transform group-hover:-translate-y-0.5" /> 立即上传
                      <input type="file" multiple className="hidden" onChange={handleFileUpload} />
                    </label>
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'rules' && (
          <ScrollArea className="flex-1 p-6 bg-white/20">
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-8">
                <div><h3 className="text-2xl font-black text-slate-800 tracking-tight">解析策略库</h3><p className="mt-1 text-slate-400 text-[10px] font-bold">配置不同文档场景的 AI 解析逻辑</p></div>
                <Button variant="outline" onClick={() => setIsTestingApi(!isTestingApi)} className="rounded-lg h-10 px-4 border-2 border-blue-100 font-black text-[10px] gap-2 shadow-sm"><Activity size={14} /> 运行状态</Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {rules.map(r => (
                  <Card key={r.id} className={cn("rounded-[1.5rem] border-none shadow-xl transition-all duration-300 overflow-hidden", selectedRuleId === r.id ? "ring-2 ring-blue-600 bg-blue-600 text-white" : "bg-white hover:shadow-blue-600/10 hover:-translate-y-1")}>
                    <CardHeader className="p-4 pb-2">
                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-2", selectedRuleId === r.id ? "bg-white/20" : "bg-blue-50 text-blue-600")}>{r.icon}</div>
                      <CardTitle className="text-sm font-black">{r.name}</CardTitle>
                    </CardHeader>
                    <CardContent className={cn("p-4 pt-0 text-[9px] font-bold leading-relaxed", selectedRuleId === r.id ? "text-white/80" : "text-slate-500")}>{r.content}</CardContent>
                    <CardFooter className="p-4 pt-0"><Button onClick={() => setSelectedRuleId(r.id)} className={cn("w-full h-8 rounded-lg text-[10px] font-black transition-all", selectedRuleId === r.id ? "bg-white text-blue-600" : "bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white")}>{selectedRuleId === r.id ? '当前启用' : '应用'}</Button></CardFooter>
                  </Card>
                ))}
              </div>
            </div>
          </ScrollArea>
        )}

        {activeTab === 'stats' && (
          <ScrollArea className="flex-1 p-6 bg-white/20">
            <div className="max-w-4xl mx-auto space-y-6">
              <header className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-xl shadow-blue-600/20"><Database size={20} /></div>
                  <div><h3 className="text-xl font-black text-slate-800 tracking-tight">用量看板</h3><p className="mt-0.5 text-slate-400 font-bold uppercase tracking-widest text-[8px]">AI 资源实时概览</p></div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => window.location.reload()}><RefreshCw size={14} /></Button>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { label: '累计调用', val: logs?.length || 0, icon: <Activity size={16} />, sub: 'Total', color: 'blue' },
                  { label: '语义消耗', val: logs?.filter(l => l.eventType === 'AIProcessing').reduce((a, c) => a + (c.consumedAmount || 0), 0) || 0, icon: <Sparkles size={16} />, sub: 'Units', color: 'purple' },
                  { label: '视觉识别', val: logs?.filter(l => l.eventType === 'DocumentProcessed').reduce((a, c) => a + (c.consumedAmount || 0), 0) || 0, icon: <Eye size={16} />, sub: 'Pages', color: 'emerald' }
                ].map(s => (
                  <Card key={s.label} className="rounded-[1.5rem] border-none shadow-xl bg-white p-5 group hover:-translate-y-1 transition-all">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-3", `bg-${s.color}-50 text-${s.color}-600`)}>{s.icon}</div>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{s.label}</p>
                    <div className="flex items-baseline gap-1 mt-1"><h4 className="text-2xl font-black text-slate-800">{s.val}</h4><span className="text-[8px] font-black text-slate-400">{s.sub}</span></div>
                  </Card>
                ))}
              </div>

              {logs && logs.length > 0 ? (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <Card className="lg:col-span-2 rounded-[1.5rem] border-none shadow-xl bg-white overflow-hidden">
                      <div className="px-5 py-3 border-b border-slate-50 flex items-center gap-2"><BarChart3 size={14} className="text-blue-600" /><h4 className="font-black text-[10px] text-slate-800">趋势 (7D)</h4></div>
                      <div className="p-5 h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 8}} />
                            <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 8}} />
                            <RechartsTooltip cursor={{fill: '#f8fafc'}} content={({active, payload}) => active && payload?.length ? <div className="bg-slate-800 text-white p-2 rounded-lg shadow-2xl text-[8px] font-black uppercase">{payload[0].value} Units</div> : null} />
                            <Bar dataKey="amount" radius={[4, 4, 0, 0]}>{chartData.map((e, i) => <Cell key={`c-${i}`} fill={COLORS[i % COLORS.length]} />)}</Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </Card>
                    <Card className="rounded-[1.5rem] border-none shadow-xl bg-white overflow-hidden">
                      <div className="px-5 py-3 border-b border-slate-50 flex items-center gap-2"><PieChartIcon size={14} className="text-purple-600" /><h4 className="font-black text-[10px] text-slate-800">资源分布</h4></div>
                      <div className="p-5 h-56 flex flex-col items-center">
                        <ResponsiveContainer width="100%" height="55%">
                          <PieChart><Pie data={pieData} innerRadius={35} outerRadius={50} paddingAngle={5} dataKey="value">{pieData.map((e, i) => <Cell key={`p-${i}`} fill={COLORS[i % COLORS.length]} />)}</Pie><RechartsTooltip /></PieChart>
                        </ResponsiveContainer>
                        <div className="w-full space-y-2 mt-4">
                          {pieData.map((d, i) => (
                            <div key={d.name} className="flex items-center justify-between text-[7px] font-black uppercase tracking-widest text-slate-600">
                              <div className="flex items-center gap-1.5"><div className="w-1 h-1 rounded-full" style={{backgroundColor: COLORS[i % COLORS.length]}} />{d.name}</div>
                              <span>{d.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </Card>
                  </div>
                  <Card className="rounded-[1.5rem] border-none shadow-xl bg-white overflow-hidden pb-6">
                    <div className="px-5 py-3 border-b border-slate-50 flex items-center justify-between"><div className="flex items-center gap-2"><Clock size={14} className="text-emerald-600" /><h4 className="font-black text-[10px] text-slate-800">用量明细</h4></div><Badge variant="secondary" className="bg-slate-50 text-slate-400 text-[7px] font-black uppercase px-1.5">Recent 50</Badge></div>
                    <Table>
                      <TableHeader><TableRow className="bg-slate-50/50 border-none"><TableHead className="px-5 font-black text-[8px] uppercase text-slate-400">时间</TableHead><TableHead className="font-black text-[8px] uppercase text-slate-400">类型</TableHead><TableHead className="text-right font-black text-[8px] uppercase text-slate-400">数值</TableHead><TableHead className="px-5 font-black text-[8px] uppercase text-slate-400">单位</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {logs.map(l => (
                          <TableRow key={l.id} className="border-slate-50 hover:bg-slate-50/50 transition-colors">
                            <TableCell className="px-5 text-[9px] font-bold text-slate-500">{new Date(l.eventDateTime).toLocaleString([], {month: '2-digit', day: '2-digit', hour: '2-digit', minute:'2-digit'})}</TableCell>
                            <TableCell><Badge variant="outline" className={cn("text-[7px] font-black border-none px-1", l.eventType === 'AIProcessing' ? "bg-purple-50 text-purple-600" : "bg-blue-50 text-blue-600")}>{l.eventType === 'AIProcessing' ? '语义解析' : '视觉扫描'}</Badge></TableCell>
                            <TableCell className="text-right font-black text-[10px] text-slate-700">{l.consumedAmount || 0}</TableCell>
                            <TableCell className="px-5 text-[7px] font-black text-slate-400 uppercase tracking-widest">{l.consumptionUnit}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                </>
              ) : (
                <div className="py-24 text-center opacity-30"><Activity size={48} className="mx-auto mb-4" /><p className="font-black uppercase text-[9px] tracking-[0.2em]">暂无记录</p></div>
              )}
            </div>
          </ScrollArea>
        )}
      </main>

      <style jsx global>{`
        .prose table { @apply w-full border-collapse border border-slate-100 rounded-lg overflow-hidden my-3; }
        .prose th { @apply bg-slate-50 p-2 text-[9px] font-black uppercase text-slate-500 text-left; }
        .prose td { @apply p-2 border-t border-slate-50 text-[10px] text-slate-600; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
