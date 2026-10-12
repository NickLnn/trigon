'use client';

import { PageHeader } from '@/components/shell/page-header';
import { TrashList } from '@/components/shell/trash-list';

/** Sidebar → Trash: deleted items from every space the person can edit. */
export default function TrashPage() {
  return (
    <>
      <PageHeader title="Trash" subtitle="Deleted pages, folders and files from your spaces. Restore them within 30 days." />
      <div className="mx-auto max-w-3xl px-4 pb-12 md:px-8">
        <TrashList />
      </div>
    </>
  );
}
