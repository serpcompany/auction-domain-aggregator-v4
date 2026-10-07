import Link from 'next/link'
import type * as React from 'react'

import { ThemeToggle } from '@/components/app-shell/theme-toggle'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

// The sidebar-07 inset header: trigger, breadcrumb, and page status on the right.
export function SiteHeader({
  title,
  parent,
  children
}: {
  title: string
  parent?: { label: string; href: string }
  children?: React.ReactNode
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-2 data-vertical:h-4 data-vertical:self-auto"
      />
      <Breadcrumb>
        <BreadcrumbList>
          {parent ? (
            <>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link prefetch={false} href={parent.href} />}>
                  {parent.label}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </>
          ) : null}
          <BreadcrumbItem>
            <BreadcrumbPage>{title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <ThemeToggle />
      </div>
    </header>
  )
}
