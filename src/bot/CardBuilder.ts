import { CardFactory, Attachment } from 'botbuilder';
import fs from 'fs';
import path from 'path';
import { RoomInfo } from '../scraper/RoomScraper';
import { BookingWithRoom } from '../data/BookingRepository';

const searchCardTemplate = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'cards/search.json'), 'utf-8'),
);

export class CardBuilder {
  /**
   * 회의실 조회 폼 Card
   */
  static createSearchCard(): Attachment {
    return CardFactory.adaptiveCard(searchCardTemplate);
  }

  /**
   * 조회 결과 Card — 빈 회의실 목록 + 예약 버튼
   */
  static createResultCard(
    rooms: RoomInfo[],
    date: string,
    startTime: string,
    endTime: string,
  ): Attachment {
    const roomsByFloor = new Map<number, RoomInfo[]>();
    for (const room of rooms) {
      const list = roomsByFloor.get(room.floor) || [];
      list.push(room);
      roomsByFloor.set(room.floor, list);
    }

    const body: Record<string, unknown>[] = [
      {
        type: 'TextBlock',
        text: `${date} ${startTime}-${endTime}`,
        weight: 'Bolder',
        size: 'Large',
      },
      {
        type: 'TextBlock',
        text: `빈 회의실 ${rooms.length}개`,
        spacing: 'Small',
        color: rooms.length > 0 ? 'Good' : 'Attention',
      },
    ];

    if (rooms.length === 0) {
      body.push({
        type: 'TextBlock',
        text: '해당 시간에 사용 가능한 회의실이 없습니다.',
        wrap: true,
        color: 'Attention',
      });

      return CardFactory.adaptiveCard({
        type: 'AdaptiveCard',
        version: '1.5',
        body,
      });
    }

    // 층별 그룹핑
    for (const [floor, floorRooms] of [...roomsByFloor.entries()].sort((a, b) => a[0] - b[0])) {
      body.push({
        type: 'TextBlock',
        text: `${floor}층`,
        weight: 'Bolder',
        spacing: 'Medium',
      });

      for (const room of floorRooms) {
        const capacityText = room.capacity ? ` (${room.capacity}인)` : '';
        const buildingText = room.building ? `${room.building} ` : '';

        body.push({
          type: 'ColumnSet',
          columns: [
            {
              type: 'Column',
              width: 'stretch',
              items: [
                {
                  type: 'TextBlock',
                  text: `${buildingText}${room.name}${capacityText}`,
                },
              ],
              verticalContentAlignment: 'Center',
            },
            {
              type: 'Column',
              width: 'auto',
              items: [
                {
                  type: 'ActionSet',
                  actions: [
                    {
                      type: 'Action.Submit',
                      title: '예약',
                      style: 'positive',
                      data: {
                        action: 'bookRoom',
                        roomId: room.id,
                        roomName: room.name,
                        roomBuilding: room.building,
                        roomFloor: room.floor,
                        date,
                        startTime,
                        endTime,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        });
      }
    }

    return CardFactory.adaptiveCard({
      type: 'AdaptiveCard',
      version: '1.5',
      body,
    });
  }

  /**
   * 예약 확인/완료 Card
   */
  static createBookingConfirmCard(
    bookingId: string,
    roomName: string,
    floor: number,
    date: string,
    startTime: string,
    endTime: string,
    userName: string,
  ): Attachment {
    return CardFactory.adaptiveCard({
      type: 'AdaptiveCard',
      version: '1.5',
      body: [
        {
          type: 'TextBlock',
          text: '예약 완료!',
          weight: 'Bolder',
          size: 'Large',
          color: 'Good',
        },
        {
          type: 'FactSet',
          facts: [
            { title: '장소', value: `${floor}층 ${roomName}` },
            { title: '날짜', value: date },
            { title: '시간', value: `${startTime} - ${endTime}` },
            { title: '예약자', value: userName },
            { title: '예약번호', value: bookingId },
          ],
        },
      ],
      actions: [
        {
          type: 'Action.Submit',
          title: '취소하기',
          style: 'destructive',
          data: {
            action: 'cancelBooking',
            bookingId,
          },
        },
      ],
    });
  }

  /**
   * 내 예약 목록 Card
   */
  static createMyBookingsCard(bookings: BookingWithRoom[]): Attachment {
    if (bookings.length === 0) {
      return CardFactory.adaptiveCard({
        type: 'AdaptiveCard',
        version: '1.5',
        body: [
          {
            type: 'TextBlock',
            text: '내 예약 목록',
            weight: 'Bolder',
            size: 'Large',
          },
          {
            type: 'TextBlock',
            text: '예약된 회의실이 없습니다.',
            color: 'Accent',
          },
        ],
      });
    }

    const body: Record<string, unknown>[] = [
      {
        type: 'TextBlock',
        text: '내 예약 목록',
        weight: 'Bolder',
        size: 'Large',
      },
      {
        type: 'TextBlock',
        text: `총 ${bookings.length}건`,
        spacing: 'Small',
      },
    ];

    for (const booking of bookings) {
      const statusEmoji = booking.status === 'confirmed' ? '[확정]' : '[대기중]';

      body.push(
        {
          type: 'Container',
          separator: true,
          spacing: 'Medium',
          items: [
            {
              type: 'ColumnSet',
              columns: [
                {
                  type: 'Column',
                  width: 'stretch',
                  items: [
                    {
                      type: 'TextBlock',
                      text: `${statusEmoji} ${booking.roomFloor}층 ${booking.roomName}`,
                      weight: 'Bolder',
                    },
                    {
                      type: 'TextBlock',
                      text: `${booking.date} ${booking.startTime}-${booking.endTime}`,
                      spacing: 'None',
                    },
                  ],
                },
                {
                  type: 'Column',
                  width: 'auto',
                  items: [
                    {
                      type: 'ActionSet',
                      actions: [
                        {
                          type: 'Action.Submit',
                          title: '취소',
                          style: 'destructive',
                          data: {
                            action: 'cancelBooking',
                            bookingId: booking.id,
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      );
    }

    return CardFactory.adaptiveCard({
      type: 'AdaptiveCard',
      version: '1.5',
      body,
    });
  }

  /**
   * 에러/폴백 메시지 Card
   */
  static createErrorCard(title: string, message: string): Attachment {
    return CardFactory.adaptiveCard({
      type: 'AdaptiveCard',
      version: '1.5',
      body: [
        {
          type: 'TextBlock',
          text: title,
          weight: 'Bolder',
          size: 'Medium',
          color: 'Attention',
        },
        {
          type: 'TextBlock',
          text: message,
          wrap: true,
        },
        {
          type: 'TextBlock',
          text: '직접 사이트 이용: https://app.mile.im/login',
          spacing: 'Medium',
          size: 'Small',
          color: 'Accent',
        },
      ],
    });
  }

  /**
   * 도움말 Card
   */
  static createHelpCard(): Attachment {
    return CardFactory.adaptiveCard({
      type: 'AdaptiveCard',
      version: '1.5',
      body: [
        {
          type: 'TextBlock',
          text: '회의실 예약 챗봇 사용법',
          weight: 'Bolder',
          size: 'Large',
        },
        {
          type: 'FactSet',
          facts: [
            { title: '예약 조회', value: '빈 회의실을 검색합니다' },
            { title: '내 예약', value: '내 예약 목록을 확인합니다' },
            { title: '도움말', value: '이 도움말을 표시합니다' },
          ],
        },
        {
          type: 'TextBlock',
          text: '본관(2-8층), 별관(3-4층) 회의실 예약이 가능합니다.',
          spacing: 'Medium',
          wrap: true,
        },
      ],
      actions: [
        {
          type: 'Action.Submit',
          title: '회의실 조회하기',
          style: 'positive',
          data: { action: 'showSearchForm' },
        },
      ],
    });
  }
}
