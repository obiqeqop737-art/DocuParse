"use client";

import React, { useState, useEffect } from 'react';
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
  Database
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { extractDataWithAI } from '@/ai/flows/extract-data-with-ai';

// Mock data types
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
  const [activeTab, setActiveTab] = useState('dashboard');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [rules, setRules] = useState<ExtractionRule[]>([
    { id: '1', name: 'Standard Factory Spec', rules: 'Extract Document Title, Revision Number, Author, Issuing Department, and Material Requirements.' },
    { id: '2', name: 'Maintenance Log Rule', rules: 'Extract Equipment ID, Date of Service, Technician Name, Parts Replaced, and Next Service Date.' }
  ]);
  const [selectedRuleId, setSelectedRuleId] = useState<string>(rules[0]?.id || '');
  const [isProcessing, setIsProcessing] = useState(false);

  // Stats
  const processedCount = documents.filter(d => d.status === 'completed').length;
  const pendingCount = documents.filter(d => d.status === 'pending').length;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newDocs: Document[] = Array.from(files).map((file, idx) => ({
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      type: file.name.split('.').pop() || 'unknown',
      status: 'pending',
      content: `Simulated content for ${file.name}. Technical specification revision 2.3. Author: John Smith. Dept: Industrial Systems. Requirements: Steel S235JR, Precision Grade A.`,
      date: new Date().toLocaleDateString(),
    }));

    setDocuments(prev => [...newDocs, ...prev]);
    setActiveTab('documents');
  };

  const processDocument = async (docId: string) => {
    const doc = documents.find(d => d.id === docId);
    const rule = rules.find(r => r.id === selectedRuleId);
    
    if (!doc || !rule) return;

    setIsProcessing(true);
    setDocuments(prev => prev.map(d => d.id === docId ? { ...d, status: 'processing' } : d));

    try {
      const result = await extractDataWithAI({
        documentContent: doc.content,
        extractionRules: rule.rules
      });

      setDocuments(prev => prev.map(d => 
        d.id === docId ? { ...d, status: 'completed', extractedData: result } : d
      ));
    } catch (error) {
      console.error(error);
      setDocuments(prev => prev.map(d => d.id === docId ? { ...d, status: 'error' } : d));
    } finally {
      setIsProcessing(false);
    }
  };

  const exportData = (doc: Document, format: 'json' | 'csv') => {
    if (!doc.extractedData) return;
    
    let content = '';
    let fileName = `${doc.name.split('.')[0]}_extracted.${format}`;
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
      {/* Sidebar */}
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
            <LayoutDashboard size={20} /> Dashboard
          </Button>
          <Button 
            variant={activeTab === 'documents' ? 'secondary' : 'ghost'} 
            className="w-full justify-start gap-3"
            onClick={() => setActiveTab('documents')}
          >
            <FileText size={20} /> Documents
          </Button>
          <Button 
            variant={activeTab === 'rules' ? 'secondary' : 'ghost'} 
            className="w-full justify-start gap-3"
            onClick={() => setActiveTab('rules')}
          >
            <Settings size={20} /> Rules Editor
          </Button>
        </nav>

        <div className="p-4 mt-auto">
          <Card className="bg-primary/40 border-primary/20 text-primary-foreground">
            <CardContent className="p-4">
              <p className="text-xs opacity-70 mb-2">Usage Summary</p>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm">Processed</span>
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

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b bg-white/50 backdrop-blur-md flex items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-primary capitalize">{activeTab}</h2>
            <Separator orientation="vertical" className="h-6" />
            <Badge variant="outline" className="text-muted-foreground border-muted-foreground/20">
              v1.0.4 Stable
            </Badge>
          </div>
          <div className="flex items-center gap-3">
             <div className="relative">
                <Label htmlFor="file-upload" className="cursor-pointer">
                  <div className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm transition-colors">
                    <Upload size={16} /> Upload New
                  </div>
                </Label>
                <Input 
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

        {/* Viewport */}
        <div className="flex-1 overflow-auto p-8">
          {activeTab === 'dashboard' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="border-none shadow-sm bg-white">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Total Files</CardTitle>
                    <FileText className="h-4 w-4 text-primary" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{documents.length}</div>
                    <p className="text-xs text-muted-foreground mt-1">+12% from last week</p>
                  </CardContent>
                </Card>
                <Card className="border-none shadow-sm bg-white">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Success Rate</CardTitle>
                    <CheckCircle2 className="h-4 w-4 text-accent" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">98.4%</div>
                    <p className="text-xs text-muted-foreground mt-1">Industrial grade accuracy</p>
                  </CardContent>
                </Card>
                <Card className="border-none shadow-sm bg-white">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Pending Tasks</CardTitle>
                    <Clock className="h-4 w-4 text-orange-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{pendingCount}</div>
                    <p className="text-xs text-muted-foreground mt-1">Requires user attention</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <Card className="border-none shadow-sm bg-white overflow-hidden">
                  <CardHeader>
                    <CardTitle className="text-lg">Recent Documents</CardTitle>
                    <CardDescription>The latest files added to your library.</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[300px]">
                      <div className="px-6 pb-6">
                        {documents.length === 0 ? (
                          <div className="text-center py-12 text-muted-foreground">
                            <Upload className="mx-auto h-8 w-8 mb-4 opacity-20" />
                            <p>No documents uploaded yet.</p>
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
                                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">Ready</Badge>
                                  ) : doc.status === 'processing' ? (
                                    <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none animate-pulse">Parsing...</Badge>
                                  ) : (
                                    <Badge variant="outline">Queued</Badge>
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
                    <CardTitle className="text-lg text-accent">Intelligent Extraction</CardTitle>
                    <CardDescription className="text-primary-foreground/70">
                      Our AI-powered engine automatically identifies technical schemas and values.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 relative z-10">
                    <div className="bg-white/10 backdrop-blur-md rounded-lg p-4 border border-white/10 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-accent uppercase tracking-wider">
                         <div className="w-2 h-2 rounded-full bg-accent animate-ping" /> Live Status
                      </div>
                      <p className="text-sm font-light">
                        System ready. Processing speeds at 0.4s/page. Enhanced pattern recognition active for DIN and ISO standards.
                      </p>
                    </div>
                    <Button variant="secondary" className="w-full gap-2 group" onClick={() => setActiveTab('rules')}>
                      Configure Extraction Rules <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <p className="text-[10px] text-primary-foreground/50">Last security audit: Today, 08:32 AM</p>
                  </CardFooter>
                </Card>
              </div>
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-500">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-bold text-primary">Document Library</h3>
                  <p className="text-muted-foreground">Manage and analyze your technical files.</p>
                </div>
                <div className="flex gap-2">
                  <div className="w-64">
                    <Label className="sr-only">Extraction Rule</Label>
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
                        <div>
                          <CardTitle className="text-lg">{doc.name}</CardTitle>
                          <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                            <span>{doc.type.toUpperCase()} Format</span>
                            <span>•</span>
                            <span>{doc.date}</span>
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
                            Extract Data
                          </Button>
                        )}
                        {doc.status === 'processing' && (
                          <Button disabled className="bg-primary/50 cursor-wait">
                            <Clock className="mr-2 h-4 w-4 animate-spin" /> Processing
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
                              <p className="text-sm font-medium text-primary line-clamp-2">{value || <span className="italic text-muted-foreground font-normal">Not found</span>}</p>
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
                    <h4 className="text-lg font-medium text-primary">Start by uploading a file</h4>
                    <p className="text-sm text-muted-foreground mb-6">Drag and drop or use the upload button above.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-500 max-w-4xl mx-auto">
              <div>
                <h3 className="text-2xl font-bold text-primary">Extraction Rules</h3>
                <p className="text-muted-foreground">Define what the AI should look for in your documents.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="border-none shadow-sm flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-lg">Saved Rule Sets</CardTitle>
                    <CardDescription>Select a rule set to modify it.</CardDescription>
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
                      const newRule = { id, name: 'New Custom Rule', rules: 'List extraction fields here...' };
                      setRules([...rules, newRule]);
                      setSelectedRuleId(id);
                    }}>
                      <Plus size={16} /> Create New Template
                    </Button>
                  </CardFooter>
                </Card>

                <Card className="border-none shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-lg">Edit Rule Configuration</CardTitle>
                    <CardDescription>Natural language instructions for the parser.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Template Name</Label>
                      <Input 
                        value={rules.find(r => r.id === selectedRuleId)?.name || ''} 
                        onChange={(e) => setRules(prev => prev.map(r => r.id === selectedRuleId ? { ...r, name: e.target.value } : r))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Instruction Rules</Label>
                      <Textarea 
                        rows={8}
                        placeholder="E.g., Extract Product Name, Dimensions, Weight, Material Code, and Revision History..."
                        value={rules.find(r => r.id === selectedRuleId)?.rules || ''}
                        onChange={(e) => setRules(prev => prev.map(r => r.id === selectedRuleId ? { ...r, rules: e.target.value } : r))}
                        className="resize-none"
                      />
                    </div>
                    <div className="bg-accent/10 p-4 rounded-lg border border-accent/20">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="text-accent shrink-0 mt-0.5" size={18} />
                        <p className="text-xs text-primary leading-relaxed">
                          <strong>Pro Tip:</strong> Using bullet points or clear comma-separated lists of field names provides the best extraction accuracy.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="justify-end gap-2">
                    <Button variant="ghost">Reset</Button>
                    <Button className="bg-primary text-white">Save Template</Button>
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