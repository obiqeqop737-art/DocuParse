
"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  FileText, Upload, Settings, MessageSquare, Send, Loader2, Search, BookOpen, 
  Sparkles, ShieldCheck, Truck, Layers, Menu, ChevronLeft, FileDown, Eye, 
  CheckCircle2, FileSearch, Database, Activity, Clock, BarChart3, PieChart as PieChartIcon,
  RefreshCw, AlertCircle, PlayCircle, Trash2, FileSpreadsheet, Presentation, Star, ShoppingBag, User as UserIcon,
  Mic, MicOff
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

import { 
  useUser, 
  useFirestore, 
  useCollection, 
  useDoc,
  useMemoFirebase,
  initiateAnonymousSignIn,
  addDocumentNonBlocking,
  updateDocumentNonBlocking,
  deleteDocumentNonBlocking,
  setDocumentNonBlocking
} from '@/firebase';
import { collection, query, orderBy, limit, where, doc, increment, arrayUnion, arrayRemove } from 'firebase/firestore';

// 配置 Server Action 超时时间为 120 秒
export const maxDuration = 120;

if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

interface Message {
  role: 'user' | 'model';
  content: string;
}

// 定义核心预设策略
const SYSTEM_STRATEGIES = [
  {
    id: 'universal-expert',
    name: '全能文件解析专家',
    description: '通用型深度解析。强制输出[文件概览]与[文件脉络]大纲。',
    content: '你是一个全能文件解析专家。请对该文档进行深度研读，并严格按以下格式输出：\n\n1. [文件概览]：用三句话精准总结文档核心内容。\n2. [文件脉络]：以 Markdown 列表形式列出文档的主要章节和逻辑结构大纲。\n3. [详细解析]：根据文档内容对用户的提问进行专业解答。',
    authorName: '系统预设',
    starCount: 999
  },
  {
    id: 'factory-expert',
    name: '工厂文件解析专家',
    description: '专注于 SOP、BOM 表、设备规格及维保安全规程的提取与分析。',
    content: '你是一个精通工厂设备管理和生产流程的专家。请重点分析文档中的技术参数、物料清单(BOM)、操作标准程序(SOP)以及安全生产规范。如果文档包含表格数据，请优先以表格形式呈现。',
    authorName: '系统预设',
    starCount: 888
  },
  {
    id: 'logistics-expert',
    name: '物流文件解析专家',
    description: '专注于货运清单、仓储计划、路由节点及交付标准的专业分析。',
    content: '你是一个物流供应链专家。请从文档中识别出运输计划、货物明细、路由节点以及交付时间表。请重点分析供应链的效率节点和潜在风险点。',
    authorName: '系统预设',
    starCount: 777
  }
];

export default function DocuParsePro() {
  const { toast } = useToast();
  const { user, auth } = useUser();
  const db = useFirestore();
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'marketplace' | 'stats'>('chat');
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string>('universal-expert');
  
  const uploadedFilesRef = useRef<Map<string, File>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  // 1. 自动鉴权
  useEffect(() => {
    if (!user && auth) initiateAnonymousSignIn(auth);
  }, [user, auth]);

  // 2. 数据获取：用户文档列表
  const docsQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'users', user.uid, 'documents'), orderBy('createdAt', 'desc'));
  }, [db, user?.uid]);
  const { data: documentsData, isLoading: isDocsLoading } = useCollection(docsQuery);
  const documents = documentsData || [];

  // 3. 数据获取：策略市场
  const marketQuery = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return query(collection(db, 'extractionStrategies'), where('isPublic', '==', true), orderBy('starCount', 'desc'));
  }, [db, user?.uid]);
  const { data: marketplaceStrategiesData } = useCollection(marketQuery);
  const marketplaceStrategies = marketplaceStrategiesData || [];

  // 合并系统策略和市场策略
  const allStrategies = useMemo(() => {
    return [...SYSTEM_STRATEGIES, ...marketplaceStrategies];
  }, [marketplaceStrategies]);

  // 4. 数据获取：用户配置（收藏夹）
  const userProfileRef = useMemoFirebase(() => {
    if (!db || !user?.uid) return null;
    return doc(db, 'users', user.uid);
  }, [db, user?.uid]);
  const { data: userProfile } = useDoc(userProfileRef);

  // 当前选中的文档
  const selectedDoc = useMemo(() => documents.find(d => d.id === selectedDocId), [documents, selectedDocId]);

  // 自动滚动聊天
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [selectedDoc?.chatHistory, isChatting]);

  // 处理文件上传
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !user?.uid || !db) return;

    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const docId = Math.random().toString(36).substring(2, 9);
      
      const newDoc = {
        name: file.name,
        type: ext.toUpperCase(),
        status: 'pending_confirm',
        content: '',
        userId: user.uid,
        createdAt: new Date().toISOString(),
        chatHistory: []
      };
      
      uploadedFilesRef.current.set(docId, file);
      setDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', docId), newDoc, { merge: true });
      setSelectedDocId(docId);
    }
    e.target.value = '';
  };

  // 开启解析流
  const startAnalysis = async (docId: string) => {
    if (!selectedDoc || !user?.uid || !db) return;
    const file = uploadedFilesRef.current.get(docId);
    if (!file) {
      toast({ variant: "destructive", title: "本地文件缓存失效", description: "请重新上传此文件。" });
      return;
    }

    const currentStrategy = allStrategies.find(s => s.id === selectedRuleId) || SYSTEM_STRATEGIES[0];
    
    updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', docId), { status: 'processing' });

    try {
      let finalContent = "";
      const ab = await file.arrayBuffer();
      if (selectedDoc.type === 'PDF') {
        finalContent = "[PDF 内容提取中...]"; 
      } else if (selectedDoc.type === 'DOCX' || selectedDoc.type === 'DOC') {
        const res = await mammoth.extractRawText({ arrayBuffer: ab });
        finalContent = res.value;
      } else if (selectedDoc.type === 'XLSX' || selectedDoc.type === 'XLS') {
        const workbook = XLSX.read(ab);
        finalContent = workbook.SheetNames.map(name => XLSX.utils.sheet_to_txt(workbook.Sheets[name])).join('\n\n');
      } else {
        finalContent = await file.text();
      }

      if (!finalContent.trim()) throw new Error('文档内容解析为空。');

      const fullContent = `\n# 文档内容: ${selectedDoc.name}\n\n${finalContent}\n`;
      updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', docId), { content: fullContent });

      setIsChatting(true);
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          documentContent: fullContent, 
          userQuery: `请执行[${currentStrategy.name}]：开启深度分析并输出概览与脉络。`, 
          rules: currentStrategy.content, 
          history: [] 
        })
      });

      if (!res.ok) throw new Error('AI 服务请求失败');
      
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
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') break;
          try {
            const text = JSON.parse(dataStr).choices[0]?.delta?.content || "";
            if (text) {
              fullAnswer += text;
              updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', docId), { 
                chatHistory: [{ role: 'model', content: fullAnswer }],
                status: 'completed'
              });
            }
          } catch (e) {}
        }
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "解析异常", description: err.message });
      updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', docId), { status: 'error' });
    } finally {
      setIsChatting(false);
    }
  };

  // 发送消息
  const handleSendMessage = async () => {
    if (!chatInput.trim() || !selectedDoc || isChatting || !user?.uid || !db) return;
    const userMsg: Message = { role: 'user', content: chatInput };
    const history = [...(selectedDoc.chatHistory || []), userMsg];
    
    updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', selectedDoc.id), { chatHistory: history });
    setChatInput('');
    setIsChatting(true);

    try {
      const currentStrategy = allStrategies.find(s => s.id === selectedRuleId) || SYSTEM_STRATEGIES[0];
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          documentContent: selectedDoc.content, 
          userQuery: userMsg.content, 
          rules: currentStrategy.content, 
          history: selectedDoc.chatHistory 
        })
      });
      
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
            const text = JSON.parse(dataStr).choices[0]?.delta?.content || "";
            if (text) {
              fullAnswer += text;
              updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', selectedDoc.id), { 
                chatHistory: [...history, { role: 'model', content: fullAnswer }] 
              });
            }
          } catch (e) {}
        }
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "对话失败", description: err.message });
    } finally {
      setIsChatting(false);
    }
  };

  // 星标逻辑
  const toggleStar = (strategyId: string) => {
    if (!user?.uid || !db) return;
    if (SYSTEM_STRATEGIES.find(s => s.id === strategyId)) {
      toast({ title: "系统默认策略", description: "该策略为预设，无法进行星标操作。" });
      return;
    }
    const isStarred = userProfile?.starredStrategyIds?.includes(strategyId);
    
    updateDocumentNonBlocking(doc(db, 'users', user.uid), {
      starredStrategyIds: isStarred ? arrayRemove(strategyId) : arrayUnion(strategyId)
    });
    
    updateDocumentNonBlocking(doc(db, 'extractionStrategies', strategyId), {
      starCount: increment(isStarred ? -1 : 1)
    });
  };

  const getFileIcon = (type: string) => {
    const t = type.toUpperCase();
    if (t.includes('PDF')) return <FileDown size={18} />;
    if (t.includes('DOC')) return <FileText size={18} />;
    if (t.includes('XLS') || t.includes('CSV')) return <FileSpreadsheet size={18} />;
    if (t.includes('PPT')) return <Presentation size={18} />;
    return <FileText size={18} />;
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-white/70 backdrop-blur-xl border-r border-white/20">
      <div className="p-6 flex items-center gap-4">
        <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30 text-white shrink-0">
          <BookOpen size={24} />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-black text-slate-800 tracking-tight truncate leading-none mb-1">DocuParse Pro</h1>
          <p className="text-[10px] font-black text-blue-600/60 uppercase tracking-widest truncate">Enterprise AI Brain</p>
        </div>
      </div>
      
      <nav className="flex-1 px-4 space-y-2 mt-4">
        <button onClick={() => setActiveTab('chat')} className={cn("w-full flex items-center gap-3.5 px-5 py-4 rounded-2xl transition-all font-black text-[13px] tracking-wide", activeTab === 'chat' ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20" : "text-slate-500 hover:bg-white hover:text-blue-600")}>
          <MessageSquare size={20} /> 智能对话
        </button>
        <button onClick={() => setActiveTab('marketplace')} className={cn("w-full flex items-center gap-3.5 px-5 py-4 rounded-2xl transition-all font-black text-[13px] tracking-wide", activeTab === 'marketplace' ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20" : "text-slate-500 hover:bg-white hover:text-blue-600")}>
          <ShoppingBag size={20} /> 策略广场
        </button>
        <button onClick={() => setActiveTab('stats')} className={cn("w-full flex items-center gap-3.5 px-5 py-4 rounded-2xl transition-all font-black text-[13px] tracking-wide", activeTab === 'stats' ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20" : "text-slate-500 hover:bg-white hover:text-blue-600")}>
          <BarChart3 size={20} /> 统计看板
        </button>

        <div className="pt-10 pb-4 px-5 flex items-center justify-between">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">数据安全</p>
          <Badge variant="outline" className="text-[10px] font-black bg-green-50 text-green-600 border-none px-2 h-6 flex items-center gap-1.5">
            <ShieldCheck size={12} /> {user?.uid ? '已隔离' : '加载中'}
          </Badge>
        </div>
      </nav>

      <div className="p-6 border-t border-white/20">
        <label className="group relative w-full flex items-center justify-center gap-3 bg-white hover:bg-blue-600 hover:text-white py-4.5 rounded-[1.25rem] border border-blue-100 transition-all shadow-md shadow-blue-600/5 cursor-pointer active:scale-95">
          <Upload size={20} className="transition-transform group-hover:-translate-y-0.5" />
          <span className="text-[15px] font-black">上传技术文档</span>
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
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-400/10 blur-[150px] rounded-full -translate-y-1/2 translate-x-1/2 -z-10" />

        <header className="h-18 px-8 flex items-center justify-between bg-white/40 backdrop-blur-md border-b border-white/20 sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-5">
            <Button variant="ghost" size="icon" className="lg:hidden" asChild>
              <Sheet>
                <SheetTrigger><Menu size={22} /></SheetTrigger>
                <SheetContent side="left" className="p-0 w-[300px]">
                  <SheetHeader className="sr-only">
                    <SheetTitle>导航菜单</SheetTitle>
                    <SheetDescription>功能导航</SheetDescription>
                  </SheetHeader>
                  <SidebarContent />
                </SheetContent>
              </Sheet>
            </Button>
            <Button variant="ghost" size="icon" className="hidden lg:flex text-slate-400 hover:bg-white" onClick={() => setIsSidebarOpen(!isSidebarOpen)}><ChevronLeft className={cn("transition-transform", !isSidebarOpen && "rotate-180")} size={22} /></Button>
            <h2 className="font-black text-slate-800 text-lg tracking-tight">{activeTab === 'chat' ? '解析工作站' : activeTab === 'marketplace' ? '全局策略广场' : '用量监控'}</h2>
          </div>
          <div className="flex items-center gap-4">
            <Badge className="bg-white/90 border-blue-100 text-blue-600 font-black px-4 py-1.5 shadow-sm flex items-center gap-2.5 text-[12px] rounded-xl">
              <Sparkles size={16} className="animate-pulse" /> DeepSeek V3 极速解析
            </Badge>
          </div>
        </header>

        {activeTab === 'chat' && (
          <div className="flex-1 flex overflow-hidden">
            <div className={cn("w-[300px] border-r border-white/20 bg-white/10 flex flex-col shrink-0", !selectedDocId && "w-full lg:w-[300px]")}>
              <div className="p-5"><div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><Input placeholder="搜索历史文档..." className="pl-12 h-12 bg-white/80 border-none rounded-2xl shadow-sm text-[13px] font-black" /></div></div>
              <ScrollArea className="flex-1 px-5">
                <div className="space-y-4 pb-12">
                  {documents.length === 0 ? (
                    <div className="py-32 text-center opacity-20"><FileSearch size={64} className="mx-auto mb-4" /><p className="text-[13px] font-black tracking-[0.2em] uppercase">等待文档载入</p></div>
                  ) : (
                    documents.map(d => (
                      <button key={d.id} onClick={() => setSelectedDocId(d.id)} className={cn("w-full p-4.5 rounded-[1.5rem] border transition-all text-left flex items-start gap-4 group relative overflow-hidden", selectedDocId === d.id ? "bg-white border-blue-600 shadow-xl shadow-blue-600/10" : "bg-transparent border-transparent hover:bg-white/60")}>
                        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm transition-colors", selectedDocId === d.id ? "bg-blue-600 text-white" : "bg-white text-slate-400")}>{getFileIcon(d.type)}</div>
                        <div className="min-w-0 flex-1">
                          <p className="font-black text-[12px] text-slate-800 truncate mb-1.5 max-w-[150px]">{d.name}</p>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-black text-slate-400">{new Date(d.createdAt).toLocaleDateString()}</span>
                            {d.status === 'completed' ? <Badge className="bg-green-50 text-green-600 text-[9px] h-5 border-none font-black px-2 rounded-lg">已完成</Badge> : <Badge className="bg-blue-50 text-blue-600 text-[9px] h-5 border-none font-black px-2 rounded-lg animate-pulse">解析中</Badge>}
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
                    <div className="flex-1 flex items-center justify-start p-16">
                      <Card className="max-w-md w-full rounded-[2.8rem] border-none shadow-2xl bg-white/90 backdrop-blur-xl p-12 text-center animate-in zoom-in-95">
                        <div className="w-24 h-24 bg-blue-50 text-blue-600 rounded-[2rem] flex items-center justify-center mx-auto mb-10 shadow-inner"><AlertCircle size={48} /></div>
                        <CardTitle className="text-2xl font-black mb-6 tracking-tight">确认开启解析</CardTitle>
                        <CardDescription className="text-[15px] font-black text-slate-500 mb-10 leading-relaxed">系统准备处理文档：<br/><span className="text-blue-600 font-black text-lg">"{selectedDoc.name}"</span><br/>AI 将为您梳理全局脉络并抓取核心细节。</CardDescription>
                        <div className="space-y-4">
                          <Button onClick={() => startAnalysis(selectedDoc.id)} className="w-full h-16 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black text-lg shadow-xl shadow-blue-600/30 flex items-center justify-center gap-3.5"><PlayCircle size={24} /> 开启 AI 深度解析</Button>
                          <Button variant="ghost" onClick={() => { deleteDocumentNonBlocking(doc(db, 'users', user?.uid!, 'documents', selectedDoc.id)); setSelectedDocId(null); }} className="text-slate-400 font-black hover:text-red-500 text-[14px]"><Trash2 size={20} className="mr-2.5" /> 舍弃此文档</Button>
                        </div>
                      </Card>
                    </div>
                  ) : (
                    <>
                      <ScrollArea className="flex-1 px-10 py-12" ref={scrollRef}>
                        <div className="max-w-3xl space-y-12 pb-32">
                          {selectedDoc.chatHistory?.map((m, i) => (
                            <div key={i} className={cn("flex gap-8", m.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                              <div className={cn("w-12 h-12 rounded-[1.25rem] flex items-center justify-center shrink-0 border shadow-sm font-black text-[14px] tracking-widest", m.role === 'user' ? "bg-white text-slate-400" : "bg-blue-600 text-white shadow-blue-600/20")}>{m.role === 'user' ? 'ME' : <Sparkles size={24} />}</div>
                              <div className={cn("max-w-[90%] p-8 rounded-[2.5rem] text-[15px] leading-relaxed shadow-sm", m.role === 'user' ? "bg-blue-600 text-white rounded-tr-none" : "bg-white/95 backdrop-blur-md border rounded-tl-none prose prose-slate prose-sm")}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                              </div>
                            </div>
                          ))}
                          {isChatting && (
                            <div className="flex gap-8">
                              <div className="w-12 h-12 rounded-[1.25rem] bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-lg shadow-blue-600/20"><Sparkles size={24} /></div>
                              <div className="bg-white/80 backdrop-blur-md border p-8 rounded-[2.5rem] rounded-tl-none flex items-center gap-4 shadow-sm"><Loader2 className="animate-spin text-blue-600" size={24} /><span className="text-[14px] font-black text-slate-700 tracking-wider">正在深度研读并构建脉络...</span></div>
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                      <footer className="p-10 border-t border-white/20 bg-white/60 backdrop-blur-3xl">
                        <div className="max-w-3xl relative">
                          <textarea placeholder="进一步向全能专家追问文档细节..." className="w-full min-h-[72px] max-h-[250px] bg-white border-none rounded-[2rem] p-7 pr-24 text-[15px] font-black focus:ring-2 focus:ring-blue-100 shadow-inner resize-none no-scrollbar placeholder:text-slate-300" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} />
                          <div className="absolute right-6 bottom-6 flex items-center gap-3">
                             <Button onClick={handleSendMessage} disabled={!chatInput.trim() || isChatting} className="w-14 h-14 rounded-2xl bg-blue-600 text-white shadow-xl shadow-blue-600/30 hover:scale-105 active:scale-95 transition-all"><Send size={24} /></Button>
                          </div>
                        </div>
                      </footer>
                    </>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-start pt-40 p-16 text-center">
                  <div className="w-40 h-40 bg-white/90 rounded-[3.5rem] shadow-2xl flex items-center justify-center mb-12 border border-white/20"><MessageSquare size={72} className="text-blue-600/10" /></div>
                  <h3 className="text-4xl font-black text-slate-800 tracking-tight mb-6">解析工作站就绪</h3>
                  <p className="text-slate-400 font-black text-[15px] max-w-sm leading-relaxed uppercase tracking-[0.3em]">上传文档，AI 将立即为您呈现<br/>[文件概览] 与 [文件脉络]</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'marketplace' && (
          <ScrollArea className="flex-1 p-12 bg-white/20">
            <div className="max-w-[1400px] mx-auto">
              <div className="flex items-center justify-between mb-16">
                <div>
                  <h3 className="text-4xl font-black text-slate-800 tracking-tight">全局策略广场</h3>
                  <p className="mt-4 text-slate-400 text-[16px] font-black uppercase tracking-widest">选择高效解析指令，当前每行展示 5 个策略</p>
                </div>
                <div className="flex gap-4">
                  <Badge className="bg-blue-600/10 text-blue-600 font-black px-4 py-2 text-sm border-none rounded-xl">已收录 {allStrategies.length} 个专家指令</Badge>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {allStrategies.map(s => (
                  <Card key={s.id} className={cn("rounded-[2.2rem] border-none shadow-xl bg-white hover:shadow-blue-600/15 transition-all hover:-translate-y-2 group flex flex-col h-full", selectedRuleId === s.id && "ring-2 ring-blue-600")}>
                    <CardHeader className="p-7">
                      <div className="flex items-start justify-between mb-4">
                        <div className={cn("w-14 h-14 rounded-[1.25rem] flex items-center justify-center shadow-inner", s.id.includes('expert') ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-600")}>
                          {s.id === 'logistics-expert' ? <Truck size={28} /> : s.id === 'factory-expert' ? <Layers size={28} /> : <Sparkles size={28} />}
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => toggleStar(s.id)} className={cn("rounded-xl transition-all h-11 w-11", userProfile?.starredStrategyIds?.includes(s.id) ? "text-amber-500 bg-amber-50" : "text-slate-100 hover:text-amber-500")}><Star size={24} fill={userProfile?.starredStrategyIds?.includes(s.id) ? "currentColor" : "none"} /></Button>
                      </div>
                      <CardTitle className="text-lg font-black leading-tight mb-2">{s.name}</CardTitle>
                      <CardDescription className="text-[12px] font-black line-clamp-2 h-10 text-slate-400 leading-snug">{s.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="px-7 flex-1 pb-4">
                      <div className="bg-slate-50/80 p-5 rounded-[1.5rem] text-[11px] font-black text-slate-500 line-clamp-5 h-32 overflow-hidden leading-relaxed border border-slate-100/50 italic">
                        {s.content}
                      </div>
                    </CardContent>
                    <CardFooter className="p-7 pt-0 flex flex-col gap-4 mt-auto">
                      <div className="flex items-center justify-between w-full">
                         <div className="flex items-center gap-2.5">
                            <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[9px] font-black text-slate-400 uppercase">{s.authorName?.charAt(0)}</div>
                            <span className="text-[11px] font-black text-slate-400">{s.authorName}</span>
                         </div>
                         <div className="flex items-center gap-1.5 text-slate-300 text-[11px] font-black"><Star size={12} fill="currentColor" /> {s.starCount}</div>
                      </div>
                      <Button onClick={() => { setSelectedRuleId(s.id); setActiveTab('chat'); toast({ title: "策略挂载成功", description: `已切换至[${s.name}]` }); }} className={cn("w-full h-11 rounded-xl font-black text-[13px] shadow-lg transition-all", selectedRuleId === s.id ? "bg-blue-600 text-white shadow-blue-600/20" : "bg-white text-slate-600 border border-slate-100 hover:bg-slate-50 shadow-none")}>
                        {selectedRuleId === s.id ? '当前使用中' : '挂载此策略'}
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </div>
          </ScrollArea>
        )}

        {activeTab === 'stats' && (
          <ScrollArea className="flex-1 p-12 bg-white/20">
            <div className="max-w-4xl mx-auto text-center py-40">
              <div className="w-32 h-32 bg-white rounded-[3rem] shadow-2xl flex items-center justify-center mx-auto mb-12 border border-white/20"><Activity size={64} className="text-blue-600/30" /></div>
              <h3 className="text-4xl font-black text-slate-800 tracking-tight">企业用量看板建设中</h3>
              <p className="mt-6 text-slate-400 font-black text-[16px] uppercase tracking-[0.4em]">正在对接全司算力资源监控接口...</p>
            </div>
          </ScrollArea>
        )}
      </main>

      <style jsx global>{`
        .prose p { @apply text-[15px] leading-relaxed mb-6 text-slate-600 font-medium; }
        .prose h1, .prose h2, .prose h3 { @apply font-black text-slate-800 mt-10 mb-5 tracking-tight; }
        .prose table { @apply w-full border-collapse border border-slate-100 rounded-2xl overflow-hidden my-8 shadow-sm bg-white/50; }
        .prose th { @apply bg-slate-50 p-5 text-[12px] font-black uppercase text-slate-500 text-left border-b; }
        .prose td { @apply p-5 border-t border-slate-50 text-[14px] text-slate-600 font-medium; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
