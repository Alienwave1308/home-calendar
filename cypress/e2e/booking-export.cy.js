describe('Booking Mini App - Calendar Export E2E', () => {
  let slotStartIso;
  let slotEndIso;

  beforeEach(() => {
    const now = new Date();
    now.setDate(now.getDate() + 1);
    now.setHours(10, 0, 0, 0);
    slotStartIso = now.toISOString();
    slotEndIso = new Date(now.getTime() + (60 * 60 * 1000)).toISOString();

    cy.intercept('GET', /\/api\/public\/master\/[^/]+\/?(?:\?.*)?$/, {
      statusCode: 200,
      body: {
        master: {
          id: 1,
          display_name: 'Мастер',
          timezone: 'Asia/Novosibirsk',
          booking_slug: 'test-master'
        },
        services: [{ id: '10', name: 'Шугаринг', duration_minutes: 60, price: 2000 }]
      }
    }).as('getMaster');

    cy.intercept('GET', /\/api\/public\/master\/test-master\/slots.*/, {
      statusCode: 200,
      body: {
        slots: [{ start: slotStartIso, end: slotEndIso }]
      }
    }).as('getSlots');

    cy.intercept('POST', /\/api\/public\/master\/test-master\/book\/?$/, (req) => {
      req.reply({
        statusCode: 201,
        body: {
          id: 1,
          status: 'confirmed',
          pricing: {
            promo_code: req.body.promo_code || null,
            promo_reward_type: req.body.promo_code ? 'percent' : null,
            promo_usage_mode: req.body.promo_code ? 'single_use' : null
          }
        }
      });
    }).as('postBook');

    cy.visit('/booking.html?slug=test-master', {
      onBeforeLoad(win) {
        win.Telegram = {
          WebApp: {
            initData: 'test-init-data',
            initDataUnsafe: { user: { id: 1, username: 'client' } },
            ready() {},
            expand() {},
            openLink() {}
          }
        };
      }
    });
    cy.wait('@getMaster', { timeout: 10000 });

    cy.window().then((win) => {
      cy.stub(win.Telegram.WebApp, 'openLink').as('openLink');
    });
  });

  it('completes booking flow and shows confirmation screen', () => {
    cy.contains('.service-card', 'Шугаринг').click();
    cy.get('#dockAction').click();
    cy.wait('@getSlots');

    cy.get('.day.available').first().click();
    cy.get('.slot-chip').first().click();
    cy.get('#dockAction').click();
    cy.get('#noteInput').type('Зона подмышек');
    cy.get('#confirmSubmit').click();
    cy.wait('@postBook').then((interception) => {
      expect(interception.request.body.service_ids).to.deep.equal([10]);
      expect(interception.request.body.start_at).to.equal(slotStartIso);
      expect(interception.request.body.client_note).to.equal('Зона подмышек');
    });

    cy.get('#screen-done').should('have.class', 'active');
    cy.get('#doneText').should('contain.text', 'Стоимость');
  });

  it('keeps service selected when touch/pointer and synthetic click both fire', () => {
    cy.get('#dock').should('not.have.class', 'visible');

    cy.contains('.service-card', 'Шугаринг').then(($card) => {
      const card = $card[0];
      const win = card.ownerDocument.defaultView;
      const touchLikeEvent = typeof win.PointerEvent === 'function'
        ? new win.PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch' })
        : new win.Event('touchend', { bubbles: true, cancelable: true });

      card.dispatchEvent(touchLikeEvent);
      card.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    cy.contains('.service-card.selected', 'Шугаринг').should('be.visible');
    cy.contains('.service-card.selected .service-selected-tag', 'Выбрана').should('be.visible');
    cy.get('#dockTitle').should('contain.text', '1 услуга');
    cy.get('#dockSelectedList').should('have.class', 'visible');
    cy.get('#dockSelectedList li').should('have.length', 1).first().should('contain.text', 'Шугаринг');
  });

  it('renders month calendar view for date picking', () => {
    cy.contains('.service-card', 'Шугаринг').click();
    cy.get('#dockAction').click();
    cy.wait('@getSlots');

    cy.get('#calMonth').should('not.have.text', '');
    cy.get('#calPrev').should('be.disabled');
    cy.get('#calGrid .day').should('have.length.at.least', 28);
    cy.get('.day.available').first().click();
    cy.get('.slot-chip').should('have.length.at.least', 1);
  });

  it('sends promo code from confirm screen to booking API', () => {
    cy.contains('.service-card', 'Шугаринг').click();
    cy.get('#dockAction').click();
    cy.wait('@getSlots');

    cy.get('.day.available').first().click();
    cy.get('.slot-chip').first().click();
    cy.get('#dockAction').click();
    cy.get('#promoInput').clear().type('once10');
    cy.get('#confirmSubmit').click();

    cy.wait('@postBook').then((interception) => {
      expect(interception.request.body.service_ids).to.deep.equal([10]);
      expect(interception.request.body.promo_code).to.equal('ONCE10');
    });
    cy.get('#screen-done').should('have.class', 'active');
  });
});
