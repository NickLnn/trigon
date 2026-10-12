'use client';

import Link from 'next/link';
import { use } from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { TrashList } from '@/components/shell/trash-list';
import { useSpace } from '@/lib/queries';

/** One space's trash (space header → trash icon, or the space's ⋯ menu). */
export default function SpaceTrashPage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = use(params);
  const { data: space } = useSpace(spaceId);
  return (
    <>
      <PageHeader back title="Trash" subtitle={space ? `${space.name} · deleted items are kept for 30 days` : undefined} />
      <div className="mx-auto max-w-3xl space-y-3 px-4 pb-12 md:px-8">
        <TrashList spaceId={spaceId} />
        <Link href="/trash" className="block px-1 text-meta font-semibold text-accent">
          Trash of all spaces
        </Link>
      </div>
    </>
  );
}
