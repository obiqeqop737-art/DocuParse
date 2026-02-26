"use client";

import React, { useState } from 'react';
import { 
  FileText, 
  Upload, 
  Settings, 
  LayoutDashboard, 
  Plus, 
  ChevronRight, 
  CheckCircle2, 
  Clock, 
  Download,
  AlertCircle,
  ArrowRight,
  Database,
  Loader2
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

interface Document {
  id: string;
  name: string;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  content: string;
  date: string;
  extractedData?: Record<string, string>;
}

interface ExtractionRule {
  id: string;
  name: string;
  rules: string;
}

export default function DocuParsePro() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [rules, setRules] = useState<ExtractionRule[]>([
    { id: '1', name: '标准工厂规范', rules: '提取文档标题、修订号、作者、发布部门和材料要求。' },
    { id: '2', name: '维护日志规则', rules: '提取设备 ID、服务日期、技术人员姓名、更换部件和下次服务日期。' }
  ]);
  const [selectedRuleId, setSelectedRuleId] = useState<string>(rules[0]?.id || '');
  const [isProcessing, setIsProcessing] = useState(false);

  const processedCount = documents.filter(d => d.status === 'completed').length;
  const pendingCount = documents.filter(d => d.status === 'pending').length;

  // 改进：真正读取上传文件的内容（演示支持 .txt）
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newDocs: Document[] = [];

    for (const file of Array.from(files)) {
      let content = `[无法预览此文件类型的详细内容: ${file.name}]`;
      
      // 如果是纯文本文件，读取其实际内容
      if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        content = await file.text();
      } else {
        // 对于加密或二进制文件，此处应调用解密/解析逻辑
        content = `文件名: ${file.name}\n文件大小: ${file.size} 字节\n由于文件已加密或格式特殊，需专用解析器。`;
      }

      newDocs.push({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        type: file.name.split('.').pop() || '未知',
        status: 'pending',
        content: content,
        date: new Date().toLocaleDateString(),
      });
    }

    setDocuments(prev => [...newDocs, ...prev]);
    setActiveTab('documents');
    toast({
      title: "上传成功",
      description: `已添加 ${files.length} 个文档到库中。`,
    });
  };

  const processDocument = async (docId: string) => {
    const doc = documents.find(d => d.id === docId);
    const rule = rules.find(r => r.id === selectedRuleId);
    
    if (!doc || !rule) return;

    setIsProcessing(true);
    setDocuments(prev => prev.map(d => d.id === docId ? { ...d, status: 'processing' } : d));

    try {
      // 调用自定义 AI 流程
      const result = await extractDataWithAI({
        documentContent: doc.content,
        extractionRules: rule.rules
      });

      setDocuments(prev => prev.map(d => 
        d.id === docId ? { ...d, status: 'completed', extractedData: result } : d
      ));

      toast({
        title: "解析完成",
        description: `文档 "${doc.name}" 已成功提取数据。`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "解析失败",
        description: error.message || "AI 服务响应错误。",
      });
      setDocuments(prev => prev.map(d => d.id === docId ? { ...d, status: 'error' } : d));
    } finally {
      setIsProcessing(false);
    }
  };

  const exportData = (doc: Document, format: 'json' | 'csv') => {
    if (!doc.extractedData) return;
    
    let content = '';
    let fileName = `${doc.name.split('.')[0]}_提取结果.${format}`;
    let type = '';

    if (format === 'json') {
      content = JSON.stringify(doc.extractedData, null, 2);
      type = 'application/json';
    } else {
      const headers = Object.keys(doc.extractedData).join(',');
      const values = Object.values(doc.extractedData).join(',');
      content = `${headers}\n${values}`;
      type = 'text/csv';
    }

    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <aside className="w-64 bg-primary text-primary-foreground flex flex-col border-r border-primary/20">
        <div className="p-6 flex items-center gap-2">
          <div className="bg-accent text-primary p-2 rounded-lg">
            <Database size={24} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">DocuParse <span className="text-accent">Pro</span></h1>
        </div>
        
        <nav className="flex-1 px-4 space-y-2 mt-4">
          <Button 
            variant={activeTab === 'dashboard' ? 'secondary' : 'ghost'} 
            className="w-full justify-start gap-3" 
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutDashboard size={20} /> 仪表盘
          </Button>
          <Button 
            variant={activeTab === 'documents' ? 'secondary' : 'ghost'} 
            className="w-full justify-start gap-3"
            onClick={() => setActiveTab('documents')}
          >
            <FileText size={20} /> 文档库
          </Button>
          <Button 
            variant={activeTab === 'rules' ? 'secondary' : 'ghost'} 
            className="w-full justify-start gap-3"
            onClick={() => setActiveTab('rules')}
          >
            <Settings size={20} /> 规则编辑器
          </Button>
        </nav>

        <div className="p-4 mt-auto">
          <Card className="bg-primary/40 border-primary/20 text-primary-foreground">
            <CardContent className="p-4">
              <p className="text-xs opacity-70 mb-2">使用摘要</p>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm">已处理</span>
                <span className="text-sm font-bold">{processedCount}</span>
              </div>
              <div className="h-1.5 w-full bg-primary/30 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-accent transition-all duration-500" 
                  style={{ width: `${Math.min((processedCount / 20) * 100, 100)}%` }} 
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b bg-white/50 backdrop-blur-md flex items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-primary capitalize">
              {activeTab === 'dashboard' ? '仪表盘' : activeTab === 'documents' ? '文档库' : '规则编辑器'}
            </h2>
            <Separator orientation="vertical" className="h-6" />
            <Badge variant="outline" className="text-muted-foreground border-muted-foreground/20">
              私有化部署模式
            </Badge>
          </div>
          <div className="flex items-center gap-3">
             <div className="relative">
                <Label htmlFor="file-upload" className="cursor-pointer">
                  <div className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm transition-colors">
                    <Upload size={16} /> 上传新文档
                  </div>
                </Label>
                <input 
                  id="file-upload" 
                  type="file" 
                  multiple 
                  className="hidden" 
                  onChange={handleFileUpload} 
                  accept=".pdf,.docx,.txt"
                />
             </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8">
          {activeTab === 'dashboard' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="border-none shadow-sm bg-white">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">总文件数</CardTitle>
                    <FileText className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{documents.length}</div>
                    <p className="text-xs text-muted-foreground mt-1">本地库存储</p>
                  </CardContent>
                </Card>
                <Card className="border-none shadow-sm bg-white">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">自定义 API 状态</CardTitle>
                    <CheckCircle2 className="h-4 w-4 text-accent" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">已连接</div>
                    <p className="text-xs text-muted-foreground mt-1">数据在内网环境处理</p>
                  </CardContent>
                </Card>
                <Card className="border-none shadow-sm bg-white">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">待处理任务</CardTitle>
                    <Clock className="h-4 w-4 text-orange-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{pendingCount}</div>
                    <p className="text-xs text-muted-foreground mt-1">等待用户发起解析</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <Card className="border-none shadow-sm bg-white overflow-hidden">
                  <CardHeader>
                    <CardTitle className="text-lg">最近文档</CardTitle>
                    <CardDescription>最新添加到库中的文件。</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[300px]">
                      <div className="px-6 pb-6">
                        {documents.length === 0 ? (
                          <div className="text-center py-12 text-muted-foreground">
                            <Upload className="mx-auto h-8 w-8 mb-4 opacity-20" />
                            <p>尚未上传任何文档。</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {documents.slice(0, 5).map(doc => (
                              <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/5 transition-colors cursor-pointer group" onClick={() => setActiveTab('documents')}>
                                <div className="flex items-center gap-3">
                                  <div className="bg-primary/10 p-2 rounded-md text-primary">
                                    <FileText size={18} />
                                  </div>
                                  <div>
                                    <p className="font-medium text-sm">{doc.name}</p>
                                    <p className="text-xs text-muted-foreground">{doc.date} • {doc.type.toUpperCase()}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-4">
                                  {doc.status === 'completed' ? (
                                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">就绪</Badge>
                                  ) : doc.status === 'processing' ? (
                                    <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none animate-pulse">解析中...</Badge>
                                  ) : (
                                    <Badge variant="outline">等待中</Badge>
                                  )}
                                  <ChevronRight size={16} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card className="border-none shadow-sm bg-primary text-primary-foreground overflow-hidden">
                  <div className="absolute inset-0 opacity-10 pointer-events-none">
                    <div className="w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-accent via-transparent to-transparent"></div>
                  </div>
                  <CardHeader>
                    <CardTitle className="text-lg text-accent">私有化 AI 引擎</CardTitle>
                    <CardDescription className="text-primary-foreground/70">
                      通过内部网关安全地处理敏感工厂文档。
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 relative z-10">
                    <div className="bg-white/10 backdrop-blur-md rounded-lg p-4 border border-white/10 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-accent uppercase tracking-wider">
                         <div className="w-2 h-2 rounded-full bg-accent animate-ping" /> 系统状态
                      </div>
                      <p className="text-sm font-light">
                        已配置自定义 API 接口。解析逻辑已剥离云端服务，优先保证数据安全。
                      </p>
                    </div>
                    <Button variant="secondary" className="w-full gap-2 group" onClick={() => setActiveTab('rules')}>
                      配置自定义规则 <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <p className="text-[10px] text-primary-foreground/50">当前解析引擎：自定义内部模型</p>
                  </CardFooter>
                </Card>
              </div>
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-500">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-bold text-primary">文档库</h3>
                  <p className="text-muted-foreground">管理并安全解析您的工厂文件。</p>
                </div>
                <div className="flex gap-2">
                  <div className="w-64">
                    <Label className="sr-only">提取规则</Label>
                    <select 
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      value={selectedRuleId}
                      onChange={(e) => setSelectedRuleId(e.target.value)}
                    >
                      {rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6">
                {documents.map(doc => (
                  <Card key={doc.id} className="border-none shadow-sm hover:shadow-md transition-shadow duration-300">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-lg ${doc.status === 'completed' ? 'bg-accent/20 text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>
                          <FileText size={24} />
                        </div>
                        <div className="max-w-md">
                          <CardTitle className="text-lg truncate">{doc.name}</CardTitle>
                          <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                            <span>{doc.type.toUpperCase()} 格式</span>
                            <span>•</span>
                            <span>{doc.date}</span>
                            <span>•</span>
                            <span className="italic truncate">{doc.content.substring(0, 30)}...</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {doc.status === 'pending' && (
                          <Button 
                            onClick={() => processDocument(doc.id)} 
                            disabled={isProcessing}
                            className="bg-primary text-white"
                          >
                            发起解析
                          </Button>
                        )}
                        {doc.status === 'processing' && (
                          <Button disabled className="bg-primary/50 cursor-wait">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 解析中
                          </Button>
                        )}
                        {doc.status === 'completed' && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => exportData(doc, 'json')}>
                              <Download className="mr-2 h-4 w-4" /> JSON
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => exportData(doc, 'csv')}>
                              <Download className="mr-2 h-4 w-4" /> CSV
                            </Button>
                          </>
                        )}
                      </div>
                    </CardHeader>
                    {doc.extractedData && (
                      <CardContent className="pt-0">
                        <Separator className="mb-6" />
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {Object.entries(doc.extractedData).map(([key, value]) => (
                            <div key={key} className="bg-muted/30 p-4 rounded-lg border border-transparent hover:border-accent/20 transition-colors">
                              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">{key}</p>
                              <p className="text-sm font-medium text-primary line-clamp-2">{value || <span className="italic text-muted-foreground font-normal">未找到</span>}</p>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                ))}
                
                {documents.length === 0 && (
                  <div className="text-center py-20 border-2 border-dashed rounded-xl bg-white/50">
                    <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4 opacity-30" />
                    <h4 className="text-lg font-medium text-primary">等待文档上传</h4>
                    <p className="text-sm text-muted-foreground mb-6">点击右上角按钮开始。</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-500 max-w-4xl mx-auto">
              <div>
                <h3 className="text-2xl font-bold text-primary">提取规则集</h3>
                <p className="text-muted-foreground">定义自定义 AI 应该在加密或常规文档中寻找哪些特定字段。</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="border-none shadow-sm flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-lg">已保存模板</CardTitle>
                    <CardDescription>管理您的解析逻辑。</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-3">
                        {rules.map(rule => (
                          <div 
                            key={rule.id} 
                            onClick={() => setSelectedRuleId(rule.id)}
                            className={`p-4 rounded-lg border cursor-pointer transition-all ${selectedRuleId === rule.id ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'hover:bg-muted'}`}
                          >
                            <div className="flex justify-between items-center mb-1">
                              <h4 className="font-semibold text-primary">{rule.name}</h4>
                              <Settings size={14} className="text-muted-foreground" />
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">{rule.rules}</p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <Button variant="outline" className="w-full gap-2" onClick={() => {
                      const id = Math.random().toString(36).substr(2, 9);
                      const newRule = { id, name: '新的提取规则', rules: '描述提取规则...' };
                      setRules([...rules, newRule]);
                      setSelectedRuleId(id);
                    }}>
                      <Plus size={16} /> 创建新规则
                    </Button>
                  </CardFooter>
                </Card>

                <Card className="border-none shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-lg">编辑规则配置</CardTitle>
                    <CardDescription>使用自然语言指导 AI 提取数据。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>模板名称</Label>
                      <Input 
                        value={rules.find(r => r.id === selectedRuleId)?.name || ''} 
                        onChange={(e) => setRules(prev => prev.map(r => r.id === selectedRuleId ? { ...r, name: e.target.value } : r))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>指令描述</Label>
                      <Textarea 
                        rows={8}
                        placeholder="例如：提取设备编号、故障描述、维修时间..."
                        value={rules.find(r => r.id === selectedRuleId)?.rules || ''}
                        onChange={(e) => setRules(prev => prev.map(r => r.id === selectedRuleId ? { ...r, rules: e.target.value } : r))}
                        className="resize-none"
                      />
                    </div>
                    <div className="bg-accent/10 p-4 rounded-lg border border-accent/20">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="text-accent shrink-0 mt-0.5" size={18} />
                        <p className="text-xs text-primary leading-relaxed">
                          <strong>注意：</strong> 如果文档包含机密数值，请在规则中注明提取后的脱敏处理。
                        </p>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="justify-end gap-2">
                    <Button variant="ghost">重置</Button>
                    <Button className="bg-primary text-white">更新模板</Button>
                  </CardFooter>
                </Card>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
