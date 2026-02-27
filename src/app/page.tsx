
"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  FileText, Upload, Settings, MessageSquare, Send, Loader2, Search, BookOpen, 
  Sparkles, ShieldCheck, Truck, Layers, Menu, ChevronLeft, FileDown, Eye, 
  CheckCircle2, FileSearch, Database, Activity, Clock, BarChart3, PieChart as PieChartIcon,
  RefreshCw, AlertCircle, PlayCircle, Trash2, FileSpreadsheet, Presentation, Star, ShoppingBag, User as UserIcon
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

interface Strategy {
  id: string;
  name: string;
  description: string;
  content: string;
  starCount: number;
  authorName: string;
  authorId: string;
}

export default function DocuParsePro() {
  const { toast } = useToast();
  const { user, auth } = useUser();
  const db = useFirestore();
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'marketplace' | 'stats'>('chat');
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string>('default-rule');
  
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
    if (!db) return null;
    return query(collection(db, 'extractionStrategies'), where('isPublic', '==', true), orderBy('starCount', 'desc'));
  }, [db]);
  const { data: marketplaceStrategiesData } = useCollection(marketQuery);
  const marketplaceStrategies = marketplaceStrategiesData || [];

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

    const currentStrategy = marketplaceStrategies.find(s => s.id === selectedRuleId) || { name: '全能解析', content: '请对该文档进行全面技术分析。' };
    
    updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', docId), { status: 'processing' });

    try {
      let finalContent = "";
      const ab = await file.arrayBuffer();
      if (selectedDoc.type === 'PDF') {
        finalContent = "[PDF 视觉研读中...]"; 
      } else if (selectedDoc.type === 'DOCX') {
        const res = await mammoth.extractRawText({ arrayBuffer: ab });
        finalContent = res.value;
      } else {
        finalContent = await file.text();
      }

      if (!finalContent.trim()) throw new Error('文档内容为空，无法解析。');

      const fullContent = `\n# 文档内容: ${selectedDoc.name}\n\n${finalContent}\n`;
      updateDocumentNonBlocking(doc(db, 'users', user.uid, 'documents', docId), { content: fullContent });

      setIsChatting(true);
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          documentContent: fullContent, 
          userQuery: `请执行[${currentStrategy.name}]：开启深度分析。`, 
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
        const chunk = decoder.decode(value, { stream: true });
        const combined = leftover + chunk;
        const lines = combined.split('\n');
        leftover = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') break;
          try {
            const data = JSON.parse(dataStr);
            const text = data.choices[0]?.delta?.content || "";
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
      const currentStrategy = marketplaceStrategies.find(s => s.id === selectedRuleId) || { content: '默认解析' };
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
    const isStarred = userProfile?.starredStrategyIds?.includes(strategyId);
    
    updateDocumentNonBlocking(doc(db, 'users', user.uid), {
      starredStrategyIds: isStarred ? arrayRemove(strategyId) : arrayUnion(strategyId)
    });
    
    updateDocumentNonBlocking(doc(db, 'extractionStrategies', strategyId), {
      starCount: increment(isStarred ? -1 : 1)
    });
    
    toast({ title: isStarred ? "已取消星标" : "星标成功", description: isStarred ? "策略已从收藏夹移除" : "策略已加入您的常用库" });
  };

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'PDF': return <FileDown size={16} />;
      case 'DOCX': return <FileText size={16} />;
      case 'XLSX': return <FileSpreadsheet size={16} />;
      case 'PPTX': return <Presentation size={16} />;
      default: return <FileText size={16} />;
    }
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-white/70 backdrop-blur-xl border-r border-white/20">
      <div className="p-5 flex items-center gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30 text-white shrink-0">
          <BookOpen size={20} />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-black text-slate-800 tracking-tight truncate">DocuParse Pro</h1>
          <p className="text-[10px] font-bold text-blue-600/60 uppercase tracking-widest truncate">AI 企业知识大脑</p>
        </div>
      </div>
      
      <nav className="flex-1 px-4 space-y-2">
        <button onClick={() => setActiveTab('chat')} className={cn("w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all font-bold text-[13px]", activeTab === 'chat' ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20" : "text-slate-500 hover:bg-white hover:text-blue-600")}>
          <MessageSquare size={18} /> 智能对话
        </button>
        <button onClick={() => setActiveTab('marketplace')} className={cn("w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all font-bold text-[13px]", activeTab === 'marketplace' ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20" : "text-slate-500 hover:bg-white hover:text-blue-600")}>
          <ShoppingBag size={18} /> 策略市场
        </button>
        <button onClick={() => setActiveTab('stats')} className={cn("w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all font-bold text-[13px]", activeTab === 'stats' ? "bg-blue-600 text-white shadow-xl shadow-blue-600/20" : "text-slate-500 hover:bg-white hover:text-blue-600")}>
          <BarChart3 size={18} /> 统计后台
        </button>

        <div className="pt-8 pb-3 px-4 flex items-center justify-between">
          <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">鉴权状态</p>
          <Badge variant="outline" className="text-[9px] font-bold bg-green-50 text-green-600 border-none px-2 h-5 flex items-center gap-1">
            <UserIcon size={10} /> {user?.isAnonymous ? '匿名员工' : '正式账号'}
          </Badge>
        </div>
      </nav>

      <div className="p-5 border-t border-white/20">
        <label className="group relative w-full flex items-center justify-center gap-2 bg-white hover:bg-blue-600 hover:text-white py-4 rounded-xl border border-blue-100 transition-all shadow-md shadow-blue-600/5 cursor-pointer active:scale-95">
          <Upload size={18} className="transition-transform group-hover:-translate-y-0.5" />
          <span className="text-[14px] font-black">上传技术文档</span>
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

        <header className="h-16 px-6 flex items-center justify-between bg-white/40 backdrop-blur-md border-b border-white/20 sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="lg:hidden" asChild><Sheet><SheetTrigger><Menu size={20} /></SheetTrigger><SheetContent side="left" className="p-0 w-[300px]"><SheetHeader className="sr-only"><SheetTitle>导航</SheetTitle><SheetDescription>菜单</SheetDescription></SheetHeader><SidebarContent /></SheetContent></Sheet></Button>
            <Button variant="ghost" size="icon" className="hidden lg:flex text-slate-400" onClick={() => setIsSidebarOpen(!isSidebarOpen)}><ChevronLeft className={cn("transition-transform", !isSidebarOpen && "rotate-180")} size={20} /></Button>
            <h2 className="font-black text-slate-800 text-base">{activeTab === 'chat' ? '解析工作站' : activeTab === 'marketplace' ? '规则广场' : '用量看板'}</h2>
          </div>
          <div className="flex items-center gap-3">
            <Badge className="bg-white/80 border-blue-100 text-blue-600 font-bold px-3 py-1 shadow-sm flex items-center gap-2">
              <Sparkles size={14} className="animate-pulse" /> DeepSeek V3 极速版
            </Badge>
          </div>
        </header>

        {activeTab === 'chat' && (
          <div className="flex-1 flex overflow-hidden">
            <div className={cn("w-[300px] border-r border-white/20 bg-white/10 flex flex-col shrink-0", !selectedDocId && "w-full lg:w-[300px]")}>
              <div className="p-4"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><Input placeholder="搜索历史文档..." className="pl-10 h-11 bg-white/80 border-none rounded-xl shadow-sm text-[13px] font-medium" /></div></div>
              <ScrollArea className="flex-1 px-4">
                <div className="space-y-4 pb-10">
                  {documents.length === 0 ? (
                    <div className="py-24 text-center opacity-20"><FileSearch size={48} className="mx-auto mb-3" /><p className="text-[12px] font-black tracking-widest">等待上传文档</p></div>
                  ) : (
                    documents.map(d => (
                      <button key={d.id} onClick={() => setSelectedDocId(d.id)} className={cn("w-[calc(100%-4px)] p-4 rounded-2xl border transition-all text-left flex items-start gap-3.5 group relative overflow-hidden", selectedDocId === d.id ? "bg-white border-blue-600 shadow-xl shadow-blue-600/10" : "bg-transparent border-transparent hover:bg-white/50")}>
                        <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-sm", selectedDocId === d.id ? "bg-blue-600 text-white" : "bg-white text-slate-400")}>{getFileIcon(d.type)}</div>
                        <div className="min-w-0 flex-1">
                          <p className="font-black text-[12px] text-slate-800 truncate mb-1.5 max-w-[160px]">{d.name}</p>
                          <div className="flex items-center gap-2.5"><span className="text-[10px] font-bold text-slate-400">{new Date(d.createdAt).toLocaleDateString()}</span>{d.status === 'completed' ? <Badge className="bg-green-50 text-green-600 text-[9px] h-4.5 border-none font-black px-1.5">已完成</Badge> : <Badge className="bg-blue-50 text-blue-600 text-[9px] h-4.5 border-none font-black px-1.5 animate-pulse">解析中</Badge>}</div>
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
                    <div className="flex-1 flex items-center p-12">
                      <Card className="max-w-md w-full rounded-[2.5rem] border-none shadow-2xl bg-white/90 backdrop-blur-xl p-10 text-center animate-in zoom-in-95">
                        <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner"><AlertCircle size={36} /></div>
                        <CardTitle className="text-2xl font-black mb-4">开启解析确认</CardTitle>
                        <CardDescription className="text-[15px] font-bold text-slate-500 mb-10 leading-relaxed">系统已识别到新文档：<br/><span className="text-blue-600 font-black text-lg">"{selectedDoc.name}"</span><br/>请确认是否立即开启 AI 深度研读。</CardDescription>
                        <div className="space-y-4">
                          <Button onClick={() => startAnalysis(selectedDoc.id)} className="w-full h-15 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black text-base shadow-xl shadow-blue-600/30 flex items-center justify-center gap-3"><PlayCircle size={22} /> 立即开启 AI 深度解析</Button>
                          <Button variant="ghost" onClick={() => { deleteDocumentNonBlocking(doc(db, 'users', user?.uid!, 'documents', selectedDoc.id)); setSelectedDocId(null); }} className="text-slate-400 font-bold hover:text-red-500 text-[14px]"><Trash2 size={18} className="mr-2" /> 移除此文档</Button>
                        </div>
                      </Card>
                    </div>
                  ) : (
                    <>
                      <ScrollArea className="flex-1 px-8 py-10" ref={scrollRef}>
                        <div className="max-w-3xl space-y-10 pb-24">
                          {selectedDoc.chatHistory?.map((m, i) => (
                            <div key={i} className={cn("flex gap-6", m.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                              <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border shadow-sm font-black text-[13px]", m.role === 'user' ? "bg-white text-slate-400" : "bg-blue-600 text-white shadow-blue-600/20")}>{m.role === 'user' ? 'YOU' : <Sparkles size={20} />}</div>
                              <div className={cn("max-w-[85%] p-7 rounded-[2.2rem] text-[15px] leading-relaxed shadow-sm", m.role === 'user' ? "bg-blue-600 text-white rounded-tr-none" : "bg-white/90 backdrop-blur-md border rounded-tl-none prose prose-slate")}>
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                              </div>
                            </div>
                          ))}
                          {isChatting && (
                            <div className="flex gap-6">
                              <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-lg shadow-blue-600/20"><Sparkles size={20} /></div>
                              <div className="bg-white/70 backdrop-blur-md border p-7 rounded-[2.2rem] rounded-tl-none flex items-center gap-3 shadow-sm"><Loader2 className="animate-spin text-blue-600" size={20} /><span className="text-[14px] font-black text-slate-700 tracking-wider">深度研读中...</span></div>
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                      <footer className="p-8 border-t border-white/20 bg-white/50 backdrop-blur-2xl">
                        <div className="max-w-3xl relative">
                          <textarea placeholder="进一步向 AI 追问文档细节..." className="w-full min-h-[64px] max-h-[220px] bg-white border-none rounded-[1.8rem] p-6 pr-20 text-[15px] font-bold focus:ring-2 focus:ring-blue-100 shadow-inner resize-none no-scrollbar" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} />
                          <Button onClick={handleSendMessage} disabled={!chatInput.trim() || isChatting} className="absolute right-5 bottom-5 w-12 h-12 rounded-xl bg-blue-600 text-white shadow-xl shadow-blue-600/30 hover:scale-105 active:scale-95 transition-all"><Send size={22} /></Button>
                        </div>
                      </footer>
                    </>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-16 text-center">
                  <div className="w-32 h-32 bg-white/80 rounded-[2.5rem] shadow-2xl flex items-center justify-center mb-10 border border-white/20"><MessageSquare size={56} className="text-blue-600/20" /></div>
                  <h3 className="text-4xl font-black text-slate-800 tracking-tight">上传技术文档开启分析</h3>
                  <p className="mt-5 text-slate-400 font-bold text-[14px] max-w-sm leading-relaxed uppercase tracking-[0.25em]">由 DEEPSEEK V3 提供全量技术理解能力</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'marketplace' && (
          <ScrollArea className="flex-1 p-10 bg-white/20">
            <div className="max-w-5xl mx-auto">
              <div className="flex items-center justify-between mb-12">
                <div><h3 className="text-3xl font-black text-slate-800 tracking-tight">解析策略广场</h3><p className="mt-3 text-slate-400 text-[14px] font-bold">查看同事共享的高效解析规则，一键星标收藏</p></div>
                <Button className="bg-blue-600 text-white rounded-xl h-14 px-8 font-black shadow-xl shadow-blue-600/30">+ 发布我的策略</Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                {marketplaceStrategies.map(s => (
                  <Card key={s.id} className="rounded-[2.8rem] border-none shadow-xl bg-white hover:shadow-blue-600/15 transition-all hover:-translate-y-1.5 group">
                    <CardHeader className="p-8">
                      <div className="flex items-start justify-between">
                        <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-5"><Layers size={28} /></div>
                        <Button variant="ghost" size="icon" onClick={() => toggleStar(s.id)} className={cn("rounded-xl transition-all h-10 w-10", userProfile?.starredStrategyIds?.includes(s.id) ? "text-amber-500 bg-amber-50" : "text-slate-200 hover:text-amber-500")}><Star size={22} fill={userProfile?.starredStrategyIds?.includes(s.id) ? "currentColor" : "none"} /></Button>
                      </div>
                      <CardTitle className="text-xl font-black">{s.name}</CardTitle>
                      <CardDescription className="text-[13px] font-bold line-clamp-2 mt-2 leading-relaxed">{s.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="px-8 pb-3"><div className="bg-slate-50 p-5 rounded-[1.5rem] text-[12px] font-mono text-slate-500 line-clamp-4 h-28 overflow-hidden leading-relaxed italic border border-slate-100">{s.content}</div></CardContent>
                    <CardFooter className="p-8 flex items-center justify-between">
                      <div className="flex items-center gap-3"><div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-[11px] font-black text-slate-400">{s.authorName?.charAt(0) || 'U'}</div><span className="text-[12px] font-bold text-slate-400">{s.authorName || '匿名专家'}</span></div>
                      <div className="flex items-center gap-2 text-slate-400 text-[12px] font-black"><Star size={14} /> {s.starCount || 0}</div>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </div>
          </ScrollArea>
        )}

        {activeTab === 'stats' && (
          <ScrollArea className="flex-1 p-10 bg-white/20">
            <div className="max-w-4xl mx-auto text-center py-24">
              <div className="w-28 h-28 bg-white rounded-[2.5rem] shadow-2xl flex items-center justify-center mx-auto mb-10 border border-white/20"><Activity size={56} className="text-blue-600/30" /></div>
              <h3 className="text-3xl font-black text-slate-800">用量看板建设中</h3>
              <p className="mt-4 text-slate-400 font-bold text-[14px] uppercase tracking-[0.3em]">实时监控算力消耗与 Token 使用情况</p>
            </div>
          </ScrollArea>
        )}
      </main>

      <style jsx global>{`
        .prose p { @apply text-[15px] leading-relaxed mb-5 text-slate-600; }
        .prose h1, .prose h2, .prose h3 { @apply font-black text-slate-800 mt-8 mb-4; }
        .prose table { @apply w-full border-collapse border border-slate-100 rounded-xl overflow-hidden my-6; }
        .prose th { @apply bg-slate-50 p-5 text-[13px] font-black uppercase text-slate-500 text-left; }
        .prose td { @apply p-5 border-t border-slate-50 text-[14px] text-slate-600; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
