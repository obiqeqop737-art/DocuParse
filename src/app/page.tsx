"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, 
  Upload, 
  Settings, 
  LayoutDashboard, 
  Plus, 
  ChevronRight, 
  CheckCircle2, 
  MessageSquare, 
  Download,
  AlertCircle,
  Send,
  Loader2,
  Trash2,
  Search,
  BookOpen
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { extractDataWithAI } from '@/ai/flows/extract-data-with-ai';
import { chatWithDoc } from '@/ai/flows/chat-with-doc-flow';
import { cn } from "@/lib/utils";

interface Message {
  role: 'user' | 'model';
  content: string;
}

interface Document {
  id: string;
  name: string;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  content: string;
  summary?: string;
  extractedData?: Record<string, string>;
  date: string;
  chatHistory: Message[];
}

export default function DocuParsePro() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('documents');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  
  // 默认解析规则
  const [customRule, setCustomRule] = useState('提取文档标题、主要结论、关键技术参数、潜在风险点和后续建议。');
  
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedDoc = documents.find(d => d.id === selectedDocId);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [selectedDoc?.chatHistory]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newDocs: Document[] = [];
    for (const file of Array.from(files)) {
      let content = "";
      if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        content = await file.text();
      } else {
        content = `[文件预览受限: ${file.name}]\n这是一个非文本格式或加密文件。系统已准备好接受解密流。`;
      }

      newDocs.push({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        type: file.name.split('.').pop() || '未知',
        status: 'pending',
        content: content,
        date: new Date().toLocaleDateString(),
        chatHistory: []
      });
    }

    setDocuments(prev => [...newDocs, ...prev]);
    toast({ title: "上传成功", description: `已添加 ${files.length} 个文档。` });
  };

  const processDocument = async (docId: string) => {
    const doc = documents.find(d => d.id === docId);
    if (!doc) return;

    setIsProcessing(true);
    setDocuments(prev => prev.map(d => d.id === docId ? { ...d, status: 'processing' } : d));

    try {
      const result = await extractDataWithAI({
        documentContent: doc.content,
        extractionRules: customRule
      });

      setDocuments(prev => prev.map(d => 
        d.id === docId ? { 
          ...d, 
          status: 'completed', 
          extractedData: result,
          summary: result['摘要'] || result['主要结论'] || Object.values(result)[0] || '解析完成，请开始对话。'
        } : d
      ));

      toast({ title: "解析完成", description: `文档 "${doc.name}" 已生成摘要。` });
    } catch (error: any) {
      toast({ variant: "destructive", title: "解析失败", description: error.message });
      setDocuments(prev => prev.map(d => d.id === docId ? { ...d, status: 'error' } : d));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !selectedDoc || isChatting) return;

    const userMsg: Message = { role: 'user', content: chatInput };
    setDocuments(prev => prev.map(d => 
      d.id === selectedDoc.id ? { ...d, chatHistory: [...d.chatHistory, userMsg] } : d
    ));
    setChatInput('');
    setIsChatting(true);

    try {
      const response = await chatWithDoc({
        documentContent: selectedDoc.content,
        userQuery: chatInput,
        history: selectedDoc.chatHistory
      });

      const modelMsg: Message = { role: 'model', content: response.answer };
      setDocuments(prev => prev.map(d => 
        d.id === selectedDoc.id ? { ...d, chatHistory: [...d.chatHistory, modelMsg] } : d
      ));
    } catch (error: any) {
      toast({ variant: "destructive", title: "发送失败", description: error.message });
    } finally {
      setIsChatting(false);
    }
  };

  return (
    <div className="flex h-screen bg-neutral-50 overflow-hidden text-neutral-900">
      {/* 侧边导航 */}
      <aside className="w-20 lg:w-64 bg-white border-r flex flex-col transition-all duration-300">
        <div className="p-6 flex items-center gap-3">
          <div className="bg-primary text-white p-2 rounded-xl shadow-lg shadow-primary/20">
            <BookOpen size={24} />
          </div>
          <h1 className="text-xl font-bold tracking-tight hidden lg:block">DocuParse</h1>
        </div>
        
        <nav className="flex-1 px-4 space-y-2 mt-4">
          <Button 
            variant={activeTab === 'documents' ? 'secondary' : 'ghost'} 
            className={cn("w-full justify-start gap-3", activeTab === 'documents' && "bg-neutral-100")}
            onClick={() => setActiveTab('documents')}
          >
            <FileText size={20} /> <span className="hidden lg:inline">文档库</span>
          </Button>
          <Button 
            variant={activeTab === 'settings' ? 'secondary' : 'ghost'} 
            className="w-full justify-start gap-3"
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={20} /> <span className="hidden lg:inline">解析设置</span>
          </Button>
        </nav>

        <div className="p-4 mt-auto border-t">
          <label className="cursor-pointer group">
            <div className="flex items-center justify-center lg:justify-start gap-3 bg-primary hover:bg-primary/90 text-white p-3 rounded-xl transition-all shadow-md">
              <Upload size={20} /> <span className="hidden lg:inline font-medium">上传文档</span>
            </div>
            <input type="file" multiple className="hidden" onChange={handleFileUpload} accept=".txt,.pdf,.docx" />
          </label>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b flex items-center justify-between px-8 z-10">
          <h2 className="text-lg font-semibold text-neutral-700">
            {activeTab === 'documents' ? '文件目录与解析' : '全局解析规则'}
          </h2>
          <div className="flex items-center gap-4">
             <div className="relative hidden md:block">
               <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
               <Input placeholder="搜索文档..." className="pl-10 w-64 bg-neutral-100 border-none h-9 text-sm" />
             </div>
             <Badge variant="secondary" className="bg-green-50 text-green-700 hover:bg-green-50 border-green-100">AI 已就绪</Badge>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {activeTab === 'documents' && (
            <>
              {/* 文档列表 */}
              <div className="w-full md:w-1/3 border-r bg-white overflow-y-auto">
                <div className="p-4 space-y-3">
                  {documents.length === 0 ? (
                    <div className="text-center py-20 opacity-40">
                      <FileText className="mx-auto mb-4" size={48} />
                      <p className="text-sm">暂无文档，请点击上传</p>
                    </div>
                  ) : (
                    documents.map(doc => (
                      <div 
                        key={doc.id} 
                        onClick={() => setSelectedDocId(doc.id)}
                        className={cn(
                          "p-4 rounded-xl border transition-all cursor-pointer group relative",
                          selectedDocId === doc.id ? "border-primary bg-primary/5 shadow-sm" : "hover:bg-neutral-50 border-transparent bg-white shadow-sm border-neutral-200"
                        )}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <div className={cn("p-2 rounded-lg", selectedDocId === doc.id ? "bg-primary text-white" : "bg-neutral-100 text-neutral-500")}>
                              <FileText size={18} />
                            </div>
                            <div>
                              <p className="font-semibold text-sm truncate max-w-[120px]">{doc.name}</p>
                              <p className="text-[10px] text-neutral-400 uppercase">{doc.type}</p>
                            </div>
                          </div>
                          {doc.status === 'completed' ? (
                            <CheckCircle2 size={16} className="text-green-500" />
                          ) : doc.status === 'processing' ? (
                            <Loader2 size={16} className="animate-spin text-primary" />
                          ) : null}
                        </div>
                        {doc.summary && (
                          <p className="text-xs text-neutral-500 line-clamp-2 leading-relaxed mt-2">{doc.summary}</p>
                        )}
                        <div className="flex items-center justify-between mt-3">
                           <span className="text-[10px] text-neutral-400">{doc.date}</span>
                           {doc.status === 'pending' && (
                             <Button size="sm" variant="ghost" className="h-7 text-xs text-primary hover:text-primary hover:bg-primary/10" onClick={(e) => { e.stopPropagation(); processDocument(doc.id); }}>
                               解析摘要
                             </Button>
                           )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 文档详情与对话 */}
              <div className="flex-1 flex flex-col bg-white overflow-hidden">
                {selectedDoc ? (
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="p-6 border-b flex items-center justify-between bg-neutral-50/50">
                      <div>
                        <h3 className="text-lg font-bold">{selectedDoc.name}</h3>
                        <p className="text-xs text-neutral-500">上传于 {selectedDoc.date}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="h-8 gap-2" onClick={() => {
                          setDocuments(prev => prev.filter(d => d.id !== selectedDoc.id));
                          setSelectedDocId(null);
                        }}>
                          <Trash2 size={14} /> 移除
                        </Button>
                      </div>
                    </div>

                    <div className="flex-1 flex overflow-hidden">
                      {/* 摘要视图 */}
                      <div className="w-1/2 p-6 overflow-y-auto border-r bg-white">
                        <div className="space-y-6">
                          <section>
                            <h4 className="text-sm font-bold flex items-center gap-2 mb-4">
                              <CheckCircle2 size={16} className="text-primary" /> 文档摘要
                            </h4>
                            {selectedDoc.status === 'completed' ? (
                              <div className="prose prose-sm max-w-none text-neutral-600 leading-relaxed">
                                {selectedDoc.summary}
                              </div>
                            ) : (
                              <div className="py-12 text-center bg-neutral-50 rounded-xl border border-dashed border-neutral-200">
                                <p className="text-sm text-neutral-400">解析后即可查看摘要</p>
                                <Button size="sm" className="mt-4" onClick={() => processDocument(selectedDoc.id)}>立即解析</Button>
                              </div>
                            )}
                          </section>

                          {selectedDoc.extractedData && (
                            <section>
                              <h4 className="text-sm font-bold flex items-center gap-2 mb-4">
                                <Settings size={16} className="text-primary" /> 提取数据
                              </h4>
                              <div className="grid gap-3">
                                {Object.entries(selectedDoc.extractedData).map(([k, v]) => (
                                  <div key={k} className="p-3 bg-neutral-50 rounded-lg border border-neutral-100">
                                    <p className="text-[10px] font-bold text-neutral-400 uppercase mb-1">{k}</p>
                                    <p className="text-sm font-medium">{v || '-'}</p>
                                  </div>
                                ))}
                              </div>
                            </section>
                          )}
                        </div>
                      </div>

                      {/* 对话界面 */}
                      <div className="flex-1 flex flex-col bg-neutral-50/30">
                        <div className="p-4 border-b bg-white text-xs font-semibold text-neutral-500 flex items-center gap-2">
                          <MessageSquare size={14} /> 深度对话解析
                        </div>
                        <ScrollArea className="flex-1 p-6" ref={scrollRef}>
                          <div className="space-y-4">
                            {selectedDoc.chatHistory.length === 0 && (
                              <div className="text-center py-20 opacity-30">
                                <MessageSquare size={48} className="mx-auto mb-4" />
                                <p className="text-sm">针对文档内容向 AI 提问...</p>
                              </div>
                            )}
                            {selectedDoc.chatHistory.map((msg, i) => (
                              <div key={i} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                                <div className={cn(
                                  "max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed shadow-sm",
                                  msg.role === 'user' ? "bg-primary text-white rounded-br-none" : "bg-white border rounded-bl-none text-neutral-700"
                                )}>
                                  {msg.content}
                                </div>
                              </div>
                            ))}
                            {isChatting && (
                              <div className="flex justify-start">
                                <div className="bg-white border p-3 rounded-2xl rounded-bl-none shadow-sm">
                                  <Loader2 size={16} className="animate-spin text-primary" />
                                </div>
                              </div>
                            )}
                          </div>
                        </ScrollArea>
                        <div className="p-4 bg-white border-t">
                          <div className="flex gap-2 relative">
                            <Textarea 
                              placeholder="询问关于文档的内容..." 
                              className="min-h-[44px] max-h-[120px] resize-none py-3 pr-12 rounded-xl bg-neutral-100 border-none focus-visible:ring-1 focus-visible:ring-primary/20"
                              value={chatInput}
                              onChange={(e) => setChatInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  handleSendMessage();
                                }
                              }}
                            />
                            <Button 
                              size="icon" 
                              className="absolute right-1 bottom-1 h-9 w-9 rounded-lg" 
                              onClick={handleSendMessage}
                              disabled={!chatInput.trim() || isChatting || selectedDoc.status !== 'completed'}
                            >
                              <Send size={18} />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-neutral-300">
                    <FileText size={64} className="mb-4 opacity-20" />
                    <p className="text-lg">请从左侧选择一个文档开始</p>
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'settings' && (
            <div className="flex-1 p-8 max-w-2xl mx-auto space-y-8">
              <header>
                <h3 className="text-2xl font-bold">解析规则设置</h3>
                <p className="text-neutral-500">定义 AI 在“解析摘要”时应该遵循的默认逻辑。</p>
              </header>

              <Card className="border-none shadow-md">
                <CardHeader>
                  <CardTitle className="text-lg">默认提取规则</CardTitle>
                  <CardDescription>这些指令将作为解析每个文档的基础。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>核心指令</Label>
                    <Textarea 
                      rows={10}
                      value={customRule}
                      onChange={(e) => setCustomRule(e.target.value)}
                      className="resize-none"
                    />
                  </div>
                  <div className="bg-primary/5 p-4 rounded-xl border border-primary/10 flex gap-3">
                    <AlertCircle size={20} className="text-primary shrink-0" />
                    <p className="text-xs text-primary/80 leading-relaxed">
                      提示：你可以要求 AI 采用特定的格式（如 JSON）或关注特定的技术细节。
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end gap-2">
                   <Button variant="ghost">恢复默认</Button>
                   <Button onClick={() => {
                     toast({ title: "设置已更新", description: "新的解析规则将应用于后续解析任务。" });
                     setActiveTab('documents');
                   }}>保存更改</Button>
                </CardFooter>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
