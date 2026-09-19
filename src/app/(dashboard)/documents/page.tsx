"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api-client";
import { businessDate } from "@/lib/dates";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  FileText,
  Download,
  Eye,
  Upload,
  Send,
  Search,
  Trash2,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  ArrowRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

type DocumentCategory =
  | "Offer Letter"
  | "Appointment Letter"
  | "Payslip"
  | "Onboarding Documents"
  | "Other";

interface DocumentRecord {
  id: string;
  name: string;
  category: DocumentCategory;
  uploadedDate: string;
  fileSize: string;
  uploadedBy: string;
  fileUrl: string;
  verified: boolean;
  employeeId?: string;
  employeeName?: string;
  employeeCode?: string;
  department?: string;
}

// ---------------------------------------------------------------------------
//  Category config
// ---------------------------------------------------------------------------

const CATEGORIES: DocumentCategory[] = [
  "Offer Letter",
  "Appointment Letter",
  "Payslip",
  "Onboarding Documents",
  "Other",
];

const CATEGORY_FILTER_OPTIONS = [
  { label: "All Categories", value: "all" },
  ...CATEGORIES.map((c) => ({ label: c, value: c })),
];

const DOCUMENT_TYPE_OPTIONS = CATEGORIES.map((c) => ({
  label: c,
  value: c,
}));

// The documents API only accepts these DB categories. The UI presents
// friendlier labels, so map them before upload.
const UI_CATEGORY_TO_DB: Record<DocumentCategory, string> = {
  "Offer Letter": "employment",
  "Appointment Letter": "employment",
  Payslip: "employment",
  "Onboarding Documents": "onboarding",
  Other: "other",
};

const CATEGORY_BADGE_VARIANT: Record<
  DocumentCategory,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  "Offer Letter": "success",
  "Appointment Letter": "default",
  Payslip: "warning",
  "Onboarding Documents": "secondary",
  Other: "secondary",
};

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Map DB category values to display categories
function mapCategory(dbCategory: string): DocumentCategory {
  const map: Record<string, DocumentCategory> = {
    onboarding: "Onboarding Documents",
    identity: "Other",
    education: "Other",
    employment: "Other",
    offer_letter: "Offer Letter",
    appointment_letter: "Appointment Letter",
    payslip: "Payslip",
    "Offer Letter": "Offer Letter",
    "Appointment Letter": "Appointment Letter",
    "Payslip": "Payslip",
    "Onboarding Documents": "Onboarding Documents",
    "Other": "Other",
  };
  return map[dbCategory] ?? "Other";
}

// ---------------------------------------------------------------------------
//  Component
// ---------------------------------------------------------------------------

export default function DocumentsPage() {
  const { isAdmin, userProfile } = useAuth();
  const { toast } = useToast();

  // State
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Document requests (admin requests a document FROM an employee).
  // Employees see the pending requests addressed to them and can fulfil
  // them by uploading a file; admins see every request.
  interface DocRequest {
    id: string;
    employee_id: string;
    description: string;
    status: "pending" | "fulfilled" | "rejected";
    created_at: string;
  }
  const [docRequests, setDocRequests] = useState<DocRequest[]>([]);
  // When set, the upload dialog is fulfilling this request.
  const [fulfillingRequest, setFulfillingRequest] = useState<DocRequest | null>(null);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch documents via API
  const fetchDocs = useCallback(async () => {
    if (!userProfile?.id) return;

    try {
      const params = isAdmin ? {} : { employee_id: userProfile.id };
      const { documents: data } = await api.documents.list(params);

      if (data) {
        const mapped: DocumentRecord[] = data.map(
          (d: Record<string, unknown>) => ({
            id: d.id as string,
            name: d.name as string,
            category: mapCategory((d.category as string) ?? "Other"),
            uploadedDate: d.uploaded_at
              ? businessDate(new Date(d.uploaded_at as string))
              : "-",
            fileSize: typeof d.file_size === "number"
              ? formatFileSize(d.file_size as number)
              : (d.file_size as string) ?? "-",
            uploadedBy: "HR Admin",
            fileUrl: (d.file_url as string) ?? "",
            verified: Boolean(d.verified),
            employeeId: (d.employee_id as string) ?? undefined,
            employeeName: (d.employee_name as string) ?? undefined,
            employeeCode: (d.employee_code as string) ?? undefined,
            department: (d.department_name as string) ?? undefined,
          }),
        );
        setDocuments(mapped);
      }
    } catch (err) {
      toast({ variant: "error", title: "Failed to load documents", description: String(err) });
    }
  }, [userProfile, isAdmin]);

  // Fetch document requests. RLS scopes employees to their own rows; the API
  // also filters non-admins to user.uid, so there is no data leak.
  const fetchRequests = useCallback(async () => {
    if (!userProfile?.id) return;
    try {
      const params = isAdmin ? {} : { employee_id: userProfile.id };
      const { documentRequests } = await api.documentRequests.list(params);
      setDocRequests((documentRequests ?? []) as DocRequest[]);
    } catch {
      // Non-fatal: the requests panel just stays empty.
    }
  }, [userProfile, isAdmin]);

  useEffect(() => {
    fetchDocs();
    fetchRequests();
  }, [fetchDocs, fetchRequests]);

  // Upload form
  const [uploadType, setUploadType] = useState("");
  const [uploadNotes, setUploadNotes] = useState("");

  // Request form
  const [requestDescription, setRequestDescription] = useState("");

  // Filtered docs
  const filteredDocs =
    categoryFilter === "all"
      ? documents
      : documents.filter((d) => d.category === categoryFilter);

  // Group by category for tabs view
  const groupedDocs = CATEGORIES.reduce(
    (acc, cat) => {
      acc[cat] = filteredDocs.filter((d) => d.category === cat);
      return acc;
    },
    {} as Record<DocumentCategory, DocumentRecord[]>,
  );

  // Handlers
  const handleUploadSubmit = async () => {
    if (!uploadType) {
      toast({
        variant: "error",
        title: "Missing document type",
        description: "Please select a document type.",
      });
      return;
    }

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast({
        variant: "error",
        title: "No file selected",
        description: "Please select a file to upload.",
      });
      return;
    }

    if (!userProfile?.id) return;

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", file.name);
      // The API only accepts DB category values, not the friendly UI labels.
      formData.append("category", UI_CATEGORY_TO_DB[uploadType as DocumentCategory] ?? "other");
      if (userProfile.id) {
        formData.append("employee_id", userProfile.id);
      }
      // If this upload fulfils a request, tell the server so it can close the
      // request (server-side, with service-role) regardless of whether an
      // employee or an admin is uploading. This is what stops HR from
      // re-requesting an already-provided document.
      if (fulfillingRequest) {
        formData.append("request_id", fulfillingRequest.id);
      }

      await api.documents.upload(formData);

      // Refresh list and close dialog
      await fetchDocs();
      await fetchRequests();

      toast({
        variant: "success",
        title: "Document uploaded",
        description: fulfillingRequest
          ? "Your document was uploaded. HR will review it shortly."
          : "Your document has been uploaded successfully.",
      });

      setUploadType("");
      setUploadNotes("");
      setFulfillingRequest(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadDialogOpen(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Upload failed. Please try again.";
      toast({
        variant: "error",
        title: "Upload failed",
        description: message,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleRequestSubmit = async () => {
    if (!requestDescription.trim()) return;
    try {
      await api.documentRequests.create(requestDescription.trim());
      toast({
        variant: "success",
        title: "Request submitted",
        description: "The document request has been recorded.",
      });
      setRequestDescription("");
      setRequestDialogOpen(false);
      await fetchRequests();
    } catch (err) {
      toast({
        variant: "error",
        title: "Failed to submit request",
        description: String(err),
      });
    }
  };

  // Open the upload dialog pre-bound to a specific request (employee fulfils it).
  const openUploadForRequest = (req: DocRequest) => {
    setFulfillingRequest(req);
    setUploadType("Other");
    setUploadDialogOpen(true);
  };

  // Admin: reject or delete a request.
  const handleRequestStatus = async (
    req: DocRequest,
    status: "fulfilled" | "rejected",
  ) => {
    try {
      await api.documentRequests.setStatus(req.id, status);
      toast({ variant: "success", title: `Request ${status}` });
      await fetchRequests();
    } catch (err) {
      toast({ variant: "error", title: "Update failed", description: String(err) });
    }
  };

  const handleRequestDelete = async (req: DocRequest) => {
    try {
      await api.documentRequests.remove(req.id);
      toast({ variant: "success", title: "Request deleted" });
      await fetchRequests();
    } catch (err) {
      toast({ variant: "error", title: "Delete failed", description: String(err) });
    }
  };

  const pendingRequests = docRequests.filter((r) => r.status === "pending");

  // Admin: delete a document (owner-or-admin enforced server-side + RLS).
  const handleDeleteDoc = async (doc: DocumentRecord) => {
    try {
      await api.documents.remove(doc.id);
      toast({ variant: "success", title: "Document deleted", description: `${doc.name} was removed.` });
      await fetchDocs();
    } catch (err) {
      toast({ variant: "error", title: "Delete failed", description: String(err) });
    }
  };

  // Admin: group documents by employee so the page is organised by person
  // (and links to each employee's detail page for full management) instead of
  // dumping every file into one flat table.
  const employeeGroups = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; code?: string; department?: string; docs: DocumentRecord[]; pending: number }
    >();
    for (const d of filteredDocs) {
      const key = d.employeeId ?? "unknown";
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name: d.employeeName ?? "Unknown employee",
          code: d.employeeCode,
          department: d.department,
          docs: [],
          pending: 0,
        });
      }
      map.get(key)!.docs.push(d);
    }
    // attach pending document-request counts per employee
    for (const r of docRequests) {
      if (r.status !== "pending") continue;
      const g = map.get(r.employee_id);
      if (g) g.pending += 1;
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredDocs, docRequests]);

  const [expandedEmp, setExpandedEmp] = useState<Set<string>>(new Set());
  const toggleEmp = (id: string) =>
    setExpandedEmp((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Download / View handlers
  const handleDownload = (doc: DocumentRecord) => {
    if (!doc.fileUrl) {
      toast({
        variant: "error",
        title: "Download unavailable",
        description: "No file URL associated with this document.",
      });
      return;
    }
    const link = document.createElement("a");
    link.href = doc.fileUrl;
    link.download = doc.name;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleView = (doc: DocumentRecord) => {
    if (!doc.fileUrl) {
      toast({
        variant: "error",
        title: "View unavailable",
        description: "No file URL associated with this document.",
      });
      return;
    }
    window.open(doc.fileUrl, "_blank", "noopener,noreferrer");
  };

  // Render document table rows
  const renderDocRows = (docs: DocumentRecord[]) =>
    docs.map((doc) => (
      <TableRow key={doc.id}>
        <TableCell>
          <div className="flex items-center gap-3">
            <FileText className="h-4 w-4 shrink-0 text-blue-500" />
            <span className="text-xs font-medium text-gray-900">
              {doc.name}
            </span>
          </div>
        </TableCell>
        <TableCell>
          <Badge variant={CATEGORY_BADGE_VARIANT[doc.category]}>
            {doc.category}
          </Badge>
        </TableCell>
        {isAdmin && (
          <TableCell className="text-xs text-gray-700">
            {doc.employeeName ?? "-"}
          </TableCell>
        )}
        <TableCell className="font-mono text-xs text-gray-500">
          {doc.uploadedDate}
        </TableCell>
        <TableCell className="font-mono text-xs text-gray-500">
          {doc.fileSize}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDownload(doc)}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleView(doc)}
            >
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              View
            </Button>
          </div>
        </TableCell>
      </TableRow>
    ));

  const tableColSpan = isAdmin ? 6 : 5;

  const renderTableHeaders = () => (
    <TableRow>
      <TableHead>Document</TableHead>
      <TableHead>Category</TableHead>
      {isAdmin && <TableHead>Employee</TableHead>}
      <TableHead>Uploaded</TableHead>
      <TableHead>Size</TableHead>
      <TableHead>Actions</TableHead>
    </TableRow>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between mb-[18px] gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight m-0 mb-1">
            Documents
          </h1>
          <p className="text-xs text-gray-500">
            {isAdmin
              ? "Manage and distribute employee documents"
              : "View and download your documents"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Category filter */}
          <div className="w-48">
            <Select
              options={CATEGORY_FILTER_OPTIONS}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              placeholder="Filter by category"
            />
          </div>

          {/* Actions: everyone can upload their own documents; only admins
              can send document requests to employees. */}
          <Button
            onClick={() => {
              setFulfillingRequest(null);
              setUploadDialogOpen(true);
            }}
          >
            <Upload className="mr-2 h-4 w-4" />
            Upload Document
          </Button>
          {isAdmin && (
            <Button variant="outline" onClick={() => setRequestDialogOpen(true)}>
              <Send className="mr-2 h-4 w-4" />
              Send Document Request
            </Button>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/*  Requested documents panel                                       */}
      {/*  - Employees: pending requests addressed to them, with Upload.   */}
      {/*  - Admins: every request, with mark-rejected / delete controls.  */}
      {/* ---------------------------------------------------------------- */}
      {((isAdmin && docRequests.length > 0) ||
        (!isAdmin && pendingRequests.length > 0)) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {isAdmin ? "Document Requests" : "Documents requested from you"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(isAdmin ? docRequests : pendingRequests).map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-800">{req.description}</p>
                  <p className="text-xs text-gray-400">
                    Requested {(req.created_at ? businessDate(new Date(req.created_at)) : '')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    variant={
                      req.status === "fulfilled"
                        ? "success"
                        : req.status === "rejected"
                          ? "destructive"
                          : "warning"
                    }
                  >
                    {req.status}
                  </Badge>
                  {!isAdmin && req.status === "pending" && (
                    <Button size="sm" onClick={() => openUploadForRequest(req)}>
                      <Upload className="mr-1.5 h-3.5 w-3.5" />
                      Upload
                    </Button>
                  )}
                  {isAdmin && req.status === "pending" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRequestStatus(req, "rejected")}
                    >
                      Reject
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => handleRequestDelete(req)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {/*  Admin: documents organised by employee                          */}
      {/* ---------------------------------------------------------------- */}
      {isAdmin && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">
              Employee Documents ({filteredDocs.length} across {employeeGroups.length} employees)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {employeeGroups.length === 0 ? (
              <div className="py-12 text-center">
                <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="text-sm text-gray-500">No documents found</p>
              </div>
            ) : (
              employeeGroups.map((g) => {
                const open = expandedEmp.has(g.id);
                return (
                  <div key={g.id} className="rounded-lg border border-gray-200">
                    {/* Employee header row */}
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => toggleEmp(g.id)}
                      >
                        {open ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {g.name}
                            {g.code && (
                              <span className="ml-2 font-mono text-xs text-gray-400">{g.code}</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-400">
                            {g.department ?? "No department"} · {g.docs.length} document{g.docs.length === 1 ? "" : "s"}
                          </p>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        {g.pending > 0 && (
                          <Badge variant="warning">{g.pending} pending request{g.pending === 1 ? "" : "s"}</Badge>
                        )}
                        {g.id !== "unknown" && (
                          <Link href={`/employees/${g.id}`}>
                            <Button variant="outline" size="sm">
                              Manage
                              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>

                    {/* Expanded document list */}
                    {open && (
                      <div className="border-t border-gray-100 px-4 py-2">
                        {g.docs.map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <FileText className="h-4 w-4 shrink-0 text-blue-500" />
                              <span className="truncate text-sm text-gray-700">{doc.name}</span>
                              <Badge variant={CATEGORY_BADGE_VARIANT[doc.category]}>{doc.category}</Badge>
                              {doc.verified && (
                                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-green-600" />
                              )}
                            </div>
                            <div className="flex shrink-0 items-center">
                              <Button variant="ghost" size="sm" onClick={() => handleView(doc)}>
                                <Eye className="mr-1 h-4 w-4" />View
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => handleDownload(doc)}>
                                <Download className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:text-red-700"
                                onClick={() => handleDeleteDoc(doc)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {/*  Employee: own documents grouped by category                     */}
      {/* ---------------------------------------------------------------- */}
      {!isAdmin && (
      <Card>
        <CardContent className="p-0">
          <Tabs defaultValue="all">
            <div className="border-b border-gray-200 px-6 pt-4">
              <TabsList>
                <TabsTrigger value="all">
                  All ({filteredDocs.length})
                </TabsTrigger>
                {CATEGORIES.map((cat) => (
                  <TabsTrigger key={cat} value={cat}>
                    {cat} ({groupedDocs[cat].length})
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* All tab */}
            <TabsContent value="all">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>{renderTableHeaders()}</TableHeader>
                  <TableBody>
                    {filteredDocs.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={tableColSpan}
                          className="py-12 text-center"
                        >
                          <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                          <p className="text-sm text-gray-500">
                            No documents found
                          </p>
                        </TableCell>
                      </TableRow>
                    ) : (
                      renderDocRows(filteredDocs)
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* Category tabs */}
            {CATEGORIES.map((cat) => (
              <TabsContent key={cat} value={cat}>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>{renderTableHeaders()}</TableHeader>
                    <TableBody>
                      {groupedDocs[cat].length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={tableColSpan}
                            className="py-12 text-center"
                          >
                            <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                            <p className="text-sm text-gray-500">
                              No {cat.toLowerCase()} documents found
                            </p>
                          </TableCell>
                        </TableRow>
                      ) : (
                        renderDocRows(groupedDocs[cat])
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {/*  Upload Document Dialog                                          */}
      {/* ---------------------------------------------------------------- */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription>
              {fulfillingRequest
                ? `Uploading in response to the request: "${fulfillingRequest.description}"`
                : isAdmin
                  ? "Upload a new document for an employee."
                  : "Upload a document to your record."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <Select
              label="Document Type"
              options={DOCUMENT_TYPE_OPTIONS}
              value={uploadType}
              onChange={(e) => setUploadType(e.target.value)}
              placeholder="Select document type"
            />

            <Input
              ref={fileInputRef}
              label="File"
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg"
            />

            <Textarea
              label="Notes"
              placeholder="Add any notes about this document..."
              value={uploadNotes}
              onChange={(e) => setUploadNotes(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUploadDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleUploadSubmit} disabled={uploading}>
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Uploading..." : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------------------- */}
      {/*  Document Request Dialog                                         */}
      {/* ---------------------------------------------------------------- */}
      <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Document Request</DialogTitle>
            <DialogDescription>
              Request an employee to upload a specific document.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <Textarea
              label="Description"
              placeholder="Describe the document you need the employee to upload..."
              value={requestDescription}
              onChange={(e) => setRequestDescription(e.target.value)}
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRequestDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleRequestSubmit}>
              <Send className="mr-2 h-4 w-4" />
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
