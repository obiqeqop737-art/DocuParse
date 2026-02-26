
"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, 
  Upload, 
  Settings, 
  MessageSquare, 
  Send,
  Loader2,
  Trash2,
  Search,
  BookOpen,
  Sparkles,
  PlusCircle,
  FileSearch,
  ShieldCheck,
  Truck,
  Layers,
  Menu,
  ChevronLeft
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { chatWithDoc } from '@/ai/flows/chat-with-doc-flow';
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

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
  status: 'processing' | 'completed' | 'error';
  content: string;
  date: string;
  chatHistory: Message[];
}

const DEFAULT_RULES: Rule[] = [
  { 
    id: '1', 
    name: '全能架构解析', 
    icon: <Layers size={16} />,
    content: '作为技术文档专家，请系统性地解析该文件。首先，请精准识别并按顺序例举出文档的所有章节目录。其次，提取全文各个章节的核心技术信息、管理要求或物流标准。最后，针对每个章节给出精炼的摘要分析。' 
  },
  { 
    id: '2', 
    name: '供应商合规审查', 
    icon: <ShieldCheck size={16} />,
    content: '重点核查文档中涉及供应商准入、质量控制、EHS合规性以及违规处罚的相关条款。请对比工厂标准，列出所有不符项或高风险点。' 
  },
  { 
    id: '3', 
    name: '物流装卸标准', 
    icon: <Truck size={16} />,
    content: '专注于提取物流作业标准、交货周期、装卸规范、托盘/包装要求以及运输保险相关条款。' 
  }
];

export default function DocuParsePro() {
  const { toast } = useToast();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'rules'>('chat');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  
  const [rules, setRules] = useState<Rule[]>(DEFAULT_RULES);
  const [selectedRuleId, setSelectedRuleId] = useState<string>(DEFAULT_RULES[0].id);
  const [isAddingRule, setIsAddingRule] = useState(false);
  const [newRule, setNewRule] = useState({ name: '', content: '' });

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRule = rules.find(r => r.id === selectedRuleId) || rules[0];
  const selectedDoc = documents.find(d => d.id === selectedDocId);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [selectedDoc?.chatHistory, isChatting]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        // 模拟 Markdown 转换逻辑，将文本内容包裹在代码块中
        const markdownContent = `\n\`\`\`markdown\n# 文档名: ${file.name}\n\n${text}\n\`\`\`\n`;
        
        const newDoc: Document = {
          id: Math.random().toString(36).substring(2, 9),
          name: file.name,
          type: file.name.split('.').pop()?.toUpperCase() || 'UNKNOWN',
          status: 'processing',
          content: markdownContent,
          date: new Date().toLocaleDateString(),
          chatHistory: []
        };

        setDocuments(prev => [newDoc, ...prev]);
        setSelectedDocId(newDoc.id);
        autoAnalyze(newDoc, markdownContent);
      } catch (err) {
        toast({ variant: "destructive", title: "文件读取失败", description: file.name });
      }
    }
  };

  const autoAnalyze = async (doc: Document, content: string) => {
    setIsChatting(true);
    try {
      const response = await chatWithDoc({
        documentContent: content,
        userQuery: "请执行全能解析规则：识别目录并提取各章节摘要。",
        rules: activeRule.content,
        history: []
      });

      setDocuments(prev => prev.map(d => 
        d.id === doc.id ? { 
          ...d, 
          status: 'completed', 
          chatHistory: [{ role: 'model', content: response.answer }] 
        } : d
      ));
    } catch (error: any) {
      setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, status: 'error' } : d));
      toast({ variant: "destructive", title: "自动解析失败", description: error.message });
    } finally {
      setIsChatting(false);
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
        rules: activeRule.content,
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

  const NavContent = () => (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900">
      <div className="p-6 flex items-center gap-3">
        <div className="bg-primary text-primary-foreground p-2 rounded-lg">
          <BookOpen size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight">DocuParse Pro</h1>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Technical Document AI</p>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        <Button 
          variant={activeTab === 'chat' ? 'secondary' : 'ghost'} 
          className="w-full justify-start gap-3 h-11"
          onClick={() => setActiveTab('chat')}
        >
          <MessageSquare size={18} /> 文档对话
        </Button>
        <Button 
          variant={activeTab === 'rules' ? 'secondary' : 'ghost'} 
          className="w-full justify-start gap-3 h-11"
          onClick={() => setActiveTab('rules')}
        >
          <Settings size={18} /> 解析规则
        </Button>

        <div className="mt-8 mb-2 px-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">当前解析规则</p>
        </div>
        {rules.map(rule => (
          <button 
            key={rule.id}
            onClick={() => setSelectedRuleId(rule.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left",
              selectedRuleId === rule.id 
                ? "bg-primary/10 text-primary font-medium" 
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {rule.icon}
            <span className="truncate">{rule.name}</span>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t">
        <label className="w-full cursor-pointer flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white p-3 rounded-xl transition-all shadow-md active:scale-95">
          <Upload size={18} /> <span className="text-sm font-semibold">上传新文件</span>
          <input type="file" multiple className="hidden" onChange={handleFileUpload} accept=".txt" />
        </label>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-muted/30 overflow-hidden font-sans">
      {/* Desktop Sidebar */}
      <aside className={cn(
        "hidden md:flex flex-col border-r transition-all duration-300",
        isSidebarOpen ? "w-64" : "w-0 overflow-hidden"
      )}>
        <NavContent />
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-background relative">
        {/* Header Bar */}
        <header className="h-16 px-4 border-b flex items-center justify-between bg-white dark:bg-slate-900 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu size={20} />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-72">
                <SheetHeader className="sr-only">
                  <SheetTitle>导航菜单</SheetTitle>
                  <SheetDescription>访问文档对话和解析规则设置</SheetDescription>
                </SheetHeader>
                <NavContent />
              </SheetContent>
            </Sheet>
            <Button 
              variant="ghost" 
              size="icon" 
              className="hidden md:flex" 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <ChevronLeft size={20} className={cn("transition-transform", !isSidebarOpen && "rotate-180")} />
            </Button>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm hidden sm:inline-block">
                {activeTab === 'chat' ? '文档对话' : '解析规则管理'}
              </span>
              {selectedDoc && activeTab === 'chat' && (
                <Badge variant="outline" className="hidden sm:inline-flex">{selectedDoc.name}</Badge>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-muted rounded-full">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-[11px] font-medium text-muted-foreground">{activeRule.name}</span>
            </div>
          </div>
        </header>

        {activeTab === 'chat' && (
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Document Library (Left in chat) */}
            <div className={cn(
              "w-full md:w-72 border-r bg-muted/20 flex flex-col",
              selectedDocId ? "hidden md:flex" : "flex"
            )}>
              <div className="p-4 border-b bg-white dark:bg-slate-900 flex flex-col gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="搜索历史文档..." className="pl-9 h-9 text-xs rounded-full bg-muted/50" />
                </div>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-3 space-y-2">
                  {documents.length === 0 ? (
                    <div className="text-center py-20 opacity-20">
                      <FileSearch className="mx-auto mb-3" size={40} />
                      <p className="text-xs font-medium">暂无文档</p>
                    </div>
                  ) : (
                    documents.map(doc => (
                      <button 
                        key={doc.id} 
                        onClick={() => setSelectedDocId(doc.id)}
                        className={cn(
                          "w-full p-3 rounded-xl border text-left transition-all",
                          selectedDocId === doc.id 
                            ? "border-primary bg-white shadow-sm ring-1 ring-primary/10" 
                            : "hover:bg-white border-transparent bg-transparent"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn("p-2 rounded-lg", selectedDocId === doc.id ? "bg-primary text-white" : "bg-muted text-muted-foreground")}>
                            <FileText size={16} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-xs truncate">{doc.name}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{doc.date} • {doc.type}</p>
                          </div>
                        </div>
                        {doc.status === 'processing' && (
                          <div className="mt-2 flex items-center gap-2 text-[10px] text-primary animate-pulse font-medium">
                            <Loader2 size={10} className="animate-spin" /> 正在研读...
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Chat Area */}
            <div className={cn(
              "flex-1 flex flex-col bg-white dark:bg-slate-950 overflow-hidden",
              !selectedDocId && "hidden md:flex"
            )}>
              {selectedDoc ? (
                <>
                  <ScrollArea className="flex-1 px-4 md:px-8 py-6" ref={scrollRef}>
                    <div className="max-w-3xl mx-auto space-y-6">
                      {selectedDoc.chatHistory.map((msg, i) => (
                        <div key={i} className={cn("flex gap-4", msg.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border",
                            msg.role === 'user' ? "bg-muted" : "bg-primary text-primary-foreground"
                          )}>
                            {msg.role === 'user' ? 'U' : <Sparkles size={14} />}
                          </div>
                          <div className={cn(
                            "max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed shadow-sm",
                            msg.role === 'user' 
                              ? "bg-primary text-primary-foreground rounded-tr-none" 
                              : "bg-muted/50 border rounded-tl-none text-foreground whitespace-pre-wrap"
                          )}>
                            {msg.content}
                          </div>
                        </div>
                      ))}
                      {isChatting && (
                        <div className="flex gap-4">
                          <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                            <Sparkles size={14} />
                          </div>
                          <div className="bg-muted/50 border p-4 rounded-2xl rounded-tl-none shadow-sm flex flex-col gap-2 max-w-[85%]">
                            <div className="flex items-center gap-2">
                              <Loader2 size={14} className="animate-spin text-primary" />
                              <span className="text-xs font-semibold">DeepSeek-V3 深度研读中...</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>

                  <footer className="p-4 md:p-6 border-t bg-white dark:bg-slate-950">
                    <div className="max-w-3xl mx-auto flex flex-col gap-3">
                      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                         {['提取核心目录', '分析合规风险', '总结物流要求', '提取技术参数'].map((hint, idx) => (
                           <Badge 
                             key={idx} 
                             variant="secondary" 
                             className="cursor-pointer hover:bg-primary hover:text-white transition-colors whitespace-nowrap py-1.5"
                             onClick={() => setChatInput(hint)}
                           >
                             {hint}
                           </Badge>
                         ))}
                      </div>
                      <div className="relative group">
                        <Textarea 
                          placeholder="输入您的问题 (DeepSeek-V3 已挂载文档上下文)..." 
                          className="min-h-[50px] max-h-[150px] resize-none py-4 px-5 pr-14 rounded-2xl bg-muted/30 border-muted focus-visible:ring-primary/20 text-sm"
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
                          className="absolute right-2 bottom-2 h-10 w-10 rounded-xl" 
                          onClick={handleSendMessage}
                          disabled={!chatInput.trim() || isChatting || selectedDoc.status === 'processing'}
                        >
                          <Send size={18} />
                        </Button>
                      </div>
                    </div>
                  </footer>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                  <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-6">
                    <MessageSquare size={32} className="text-muted-foreground/40" />
                  </div>
                  <h3 className="text-xl font-bold">开始文档对话</h3>
                  <p className="text-sm text-muted-foreground mt-2 max-w-xs">
                    请从左侧选择一个文档或上传新文件，系统将基于 DeepSeek-V3 引擎进行深度解析。
                  </p>
                  <Button variant="outline" className="mt-6 rounded-full px-8 py-6 h-auto" asChild>
                    <label className="cursor-pointer">
                      <Upload className="mr-2" size={16} /> 上传文件
                      <input type="file" multiple className="hidden" onChange={handleFileUpload} accept=".txt" />
                    </label>
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'rules' && (
          <ScrollArea className="flex-1 p-4 md:p-10">
            <div className="max-w-5xl mx-auto">
              <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
                <div>
                  <h3 className="text-2xl font-bold tracking-tight">解析策略库</h3>
                  <p className="text-muted-foreground text-sm mt-1">
                    定义的规则将作为 System Prompt 注入硅基流动 AI 引擎
                  </p>
                </div>
                <Button onClick={() => setIsAddingRule(true)} className="gap-2 rounded-xl">
                  <PlusCircle size={18} /> 新增策略
                </Button>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {rules.map(rule => (
                  <Card key={rule.id} className={cn(
                    "transition-all border-2",
                    selectedRuleId === rule.id ? "border-primary bg-primary/5" : "hover:border-primary/20"
                  )}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn("p-2 rounded-lg", selectedRuleId === rule.id ? "bg-primary text-white" : "bg-muted text-muted-foreground")}>
                            {rule.icon}
                          </div>
                          <CardTitle className="text-base font-bold">{rule.name}</CardTitle>
                        </div>
                        {['1','2','3'].includes(rule.id) ? (
                           <Badge variant="secondary" className="text-[10px]">系统</Badge>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={() => setRules(rules.filter(r => r.id !== rule.id))}>
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                        {rule.content}
                      </p>
                    </CardContent>
                    <CardFooter>
                      <Button 
                        variant={selectedRuleId === rule.id ? "default" : "outline"} 
                        className="w-full text-xs"
                        onClick={() => setSelectedRuleId(rule.id)}
                      >
                        {selectedRuleId === rule.id ? "正在使用" : "切换到此策略"}
                      </Button>
                    </CardFooter>
                  </Card>
                ))}

                {isAddingRule && (
                  <Card className="border-primary border-dashed bg-primary/5">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <PlusCircle size={18} /> 定义新策略
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-bold uppercase text-muted-foreground tracking-wider">策略名称</Label>
                        <Input 
                          placeholder="如：原材料检验标准" 
                          className="bg-white"
                          value={newRule.name}
                          onChange={e => setNewRule({...newRule, name: e.target.value})}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-bold uppercase text-muted-foreground tracking-wider">核心指令 (Prompt)</Label>
                        <Textarea 
                          placeholder="告知 AI 应该关注文档中的哪些核心要素..." 
                          className="bg-white"
                          rows={4}
                          value={newRule.content}
                          onChange={e => setNewRule({...newRule, content: e.target.value})}
                        />
                      </div>
                    </CardContent>
                    <CardFooter className="flex gap-2">
                      <Button variant="ghost" className="flex-1 text-xs" onClick={() => setIsAddingRule(false)}>取消</Button>
                      <Button className="flex-1 text-xs" onClick={() => {
                        if (newRule.name && newRule.content) {
                          setRules([...rules, { ...newRule, id: Date.now().toString(), icon: <Layers size={16} /> }]);
                          setNewRule({ name: '', content: '' });
                          setIsAddingRule(false);
                        }
                      }}>保存</Button>
                    </CardFooter>
                  </Card>
                )}
              </div>
            </div>
          </ScrollArea>
        )}
      </main>
    </div>
  );
}
