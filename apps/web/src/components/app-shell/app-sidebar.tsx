'use client'

import { GavelIcon, GlobeIcon, RefreshCwIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type * as React from 'react'

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail
} from '@/components/ui/sidebar'

const discoverItems = [
  // The Filters page belongs to Auctions.
  { title: 'Auctions', href: '/', icon: GavelIcon, activeFor: ['/', '/filters/'] },
  { title: 'Sync status', href: '/syncs/', icon: RefreshCwIcon, activeFor: ['/syncs/'] }
]

export function AppSidebar({
  failedSyncs = 0,
  ...props
}: React.ComponentProps<typeof Sidebar> & { failedSyncs?: number }) {
  // `next dev` serves pages without the trailing slash too; compare the slashed form.
  const current = usePathname().replace(/\/?$/, '/')

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <GlobeIcon className="size-4" aria-hidden="true" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">Domain Aggregator</span>
                <span className="truncate text-xs text-muted-foreground">Local inventory</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Discover</SidebarGroupLabel>
          <SidebarMenu>
            {discoverItems.map(item => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={item.activeFor.includes(current)}
                  render={<Link href={item.href} />}
                >
                  <item.icon aria-hidden="true" />
                  <span>{item.title}</span>
                </SidebarMenuButton>
                {item.href === '/syncs/' && failedSyncs > 0 ? (
                  <SidebarMenuBadge className="text-destructive">
                    {failedSyncs}
                    <span className="sr-only"> failed {failedSyncs === 1 ? 'sync' : 'syncs'}</span>
                  </SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
