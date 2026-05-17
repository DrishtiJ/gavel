import { ChatCircleText } from '@phosphor-icons/react'
import { createFileRoute } from '@tanstack/react-router'

import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'

const phoneNumber = '+1 (412) 654-3597'
const messageHref = 'sms:+14126543597&body=Hi%20gavel'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <main className="relative min-h-svh overflow-hidden bg-black font-sans text-white">
      <img
        src="/gavel-desk-bg.png"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover object-left"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.22)_0%,rgba(0,0,0,0.12)_44%,rgba(0,0,0,0.5)_100%)]" />
      <div className="absolute top-[92px] right-[8vw] bottom-0 hidden w-[35vw] items-center justify-center py-[4vh] md:flex xl:right-[12vw]">
        <div className="absolute bottom-[5vh] h-[10vh] w-full rounded-full bg-black/80 blur-2xl" />
        <div className="absolute h-[58%] w-[88%] rounded-full bg-white/7 blur-3xl" />
        <img
          src="/gavel-phone-angled.png"
          alt=""
          aria-hidden="true"
          className="relative z-10 h-full max-h-[880px] min-h-0 w-auto object-contain drop-shadow-[0_38px_84px_rgba(0,0,0,0.8)]"
        />
      </div>
      <img
        src="/gavel-phone-angled.png"
        alt=""
        aria-hidden="true"
        className="absolute right-[-30vw] bottom-[-12vh] h-[70vh] w-auto drop-shadow-[0_28px_64px_rgba(0,0,0,0.74)] md:hidden"
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0)_22%,rgba(0,0,0,0.12)_100%)]" />

      <section className="relative z-10 grid min-h-svh grid-rows-[auto_1fr]">
        <Header />

        <div className="mx-auto flex w-full max-w-[1440px] items-center px-7 py-10 sm:px-12 lg:px-20 lg:py-0">
          <HeroCopy />
        </div>
      </section>
    </main>
  )
}

function Header() {
  return (
    <header className="border-b border-white/12 bg-black/18 px-4 py-3 backdrop-blur-xl sm:px-8 sm:py-4 lg:px-14">
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center justify-between gap-4 sm:h-16">
        <a
          href="/"
          className="group flex min-w-0 items-center gap-3"
          aria-label="Gavel home"
        >
          <span className="relative flex size-11 shrink-0 items-center justify-center rounded-[1.05rem] bg-[#11100d] shadow-[0_14px_32px_rgba(0,0,0,0.34),inset_0_0_0_1px_rgba(255,255,255,0.16)] sm:size-12">
            <img
              src="/gavel-logo.png"
              alt=""
              aria-hidden="true"
              className="size-full rounded-[1.05rem]"
            />
          </span>
          <span className="font-['SF_Pro_Display','Avenir_Next',Inter,ui-sans-serif,system-ui,sans-serif] text-[2rem] leading-none font-semibold tracking-[-0.07em] text-[#f8f2e8] drop-shadow-[0_2px_18px_rgba(255,255,255,0.12)] transition-colors group-hover:text-white sm:text-[2.35rem]">
            gavel
          </span>
        </a>

        <a
          href={messageHref}
          aria-label={`Message Gavel at ${phoneNumber}`}
          className={cn(
            buttonVariants({ size: 'lg' }),
            'h-12 shrink-0 rounded-xl border-[#0a84ff] bg-[#0a84ff] px-5 text-[1.15rem] font-medium tracking-[-0.03em] text-white shadow-[0_0_34px_rgba(10,132,255,0.28)] hover:bg-[#0577ed] sm:text-[1.35rem]',
          )}
        >
          <ChatCircleText className="size-5" weight="fill" />
          <span className="hidden sm:inline">Message</span>
        </a>
      </div>
    </header>
  )
}

function HeroCopy() {
  return (
    <div className="max-w-[620px] pb-8 lg:-mt-4">
      <h1 className="max-w-[11ch] text-[4.4rem] leading-[0.95] font-semibold tracking-[-0.06em] text-balance text-white drop-shadow-[0_7px_32px_rgba(255,255,255,0.16)] sm:text-[5.6rem] lg:text-[6.1rem]">
        Sell stuff by texting <span className="text-[#5aa9ff]">gavel</span>
      </h1>

      <p className="mt-7 max-w-xl text-[1.42rem] leading-[1.34] font-medium tracking-[-0.035em] text-white/70 sm:text-[1.72rem]">
        Tell it what you want to sell. It creates the listing, handles buyer
        demand, compares offers, and texts before it acts.
      </p>

      <div className="mt-10 flex flex-col items-start gap-4">
        <a
          href={messageHref}
          className={cn(
            buttonVariants({ size: 'lg' }),
            'h-[84px] w-full gap-3.5 rounded-2xl border-[#0a84ff] bg-[#0a84ff] px-6 text-[1.42rem] font-medium tracking-[-0.04em] text-white shadow-[0_18px_54px_rgba(10,132,255,0.36)] hover:bg-[#0577ed] sm:w-auto sm:px-7 sm:text-[1.6rem]',
          )}
        >
          <span className="-ml-2 flex size-12 items-center justify-center rounded-xl bg-[#34c759] shadow-inner shadow-white/25">
            <ChatCircleText className="size-8 text-white" weight="fill" />
          </span>
          Message {phoneNumber}
        </a>
        <p className="pl-1 text-[1.05rem] leading-6 text-white/58">
          Opens Messages.
        </p>
      </div>
    </div>
  )
}
