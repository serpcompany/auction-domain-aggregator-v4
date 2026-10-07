import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { cookies } from 'next/headers'

import { AppSidebar } from '@/components/app-shell/app-sidebar'
import { ThemeProvider } from '@/components/app-shell/theme-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { queryFailedSyncCount } from '@/server/queries/sync-status'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin']
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin']
})

export const metadata: Metadata = {
  title: 'Auction Domain Aggregator',
  description: 'Personal auction and expired-domain discovery tool'
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  // The stock sidebar stores its open state in this cookie; reading it keeps
  // the server render in the state the user left it.
  const sidebarOpen = (await cookies()).get('sidebar_state')?.value !== 'false'
  // The sidebar flags failed syncs; a database that cannot be read is the
  // page's error to report, not the shell's.
  const failedSyncs = await queryFailedSyncCount().catch(() => 0)

  return (
    // The font variables sit on <html>, where globals.css applies font-sans.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml"></link>
      </head>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <a
              href="#main-content"
              className="sr-only fixed top-3 left-3 z-50 rounded-md bg-background px-3 py-2 text-sm font-medium shadow focus:not-sr-only"
            >
              Skip to main content
            </a>
            <SidebarProvider defaultOpen={sidebarOpen}>
              <AppSidebar failedSyncs={failedSyncs} />
              <SidebarInset id="main-content" tabIndex={-1} className="min-w-0">
                {children}
              </SidebarInset>
            </SidebarProvider>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
